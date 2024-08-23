"use client";
import BallMoveAnimation from "./components/ballMoveAnimation";
import Progress from "./components/progress";
import {
  ChangeEvent,
  ChangeEventHandler,
  useEffect,
  useRef,
  useState,
} from "react";
import { RequestTask, createRequestManager, formatFileSize } from "@/utils";
import TestWorker from "../workers/test.worker";
import Loading from "./components/Loading/Index";

interface ChunkUploadFnParams {
  fileChunk: Blob; // 文件片段
  index: number; // 切片索引
  chunksHash: string[]; // 切片hash
  fileHash: string; // 整个文件hash
  fileName: string; // 文件名
  fileSize: number; // 文件大小
}

type ChunkCheckFnParams = Omit<ChunkUploadFnParams, "fileChunk">;

// 交给worker计算hash值
async function workerCalculateHash(file: string): Promise<string>;
async function workerCalculateHash(
  file: File,
  options: {
    chunkSize: number;
    threadCount: number;
  }
): Promise<string[]>;
async function workerCalculateHash(
  file: File | string,
  options?: {
    chunkSize: number;
    threadCount: number;
  }
): Promise<string[] | string> {
  const { default: FileWorker } = await import("../workers/file.worker");
  return new Promise((resolve, reject) => {
    if (typeof file === "string" || !options) {
      const worker = new FileWorker();
      worker.postMessage({ file });
      return (worker.onmessage = (event) => {
        resolve(event.data as string);
        worker.terminate();
      });
    }

    const { chunkSize, threadCount } = options;
    const result: string[] = [];
    const chunksCount = Math.ceil(file.size / chunkSize); // 切片总数
    const threadChunkCount = Math.ceil(chunksCount / threadCount); // 线程分配到的切片数量

    // 切片数量小于线程数量，用切片数量来创建worker
    const createWorkerCount =
      chunksCount < threadCount ? chunksCount : threadCount;

    let finishThreadCount = 0;

    for (let i = 0; i < createWorkerCount; i++) {
      const worker = new FileWorker();
      const start = i * threadChunkCount;
      let end = (i + 1) * threadChunkCount;
      if (end > chunksCount) end = chunksCount;

      worker.postMessage({
        file,
        start: start * chunkSize,
        end: end * chunkSize,
        chunkSize,
      });

      worker.onmessage = (event) => {
        result[i] = event.data;
        worker.terminate();
        if (++finishThreadCount === createWorkerCount) resolve(result.flat());
      };

      worker.onerror = reject;
    }
  });
}

export default function Home() {
  const [loading, setLoading] = useState(false);
  // key = hash + index
  const [fileListStatus, setFileListStatus] = useState<{
    [key: string]: {
      index: number;
      percent: number;
      fileName: string;
      size: number;
    };
  }>({});
  const [isPaused, setIsPaused] = useState<{ [key: string]: boolean }>();
  const pauseFn = useRef<{ [key: string]: () => any }>();
  const resumeFn = useRef<{ [key: string]: () => any }>();
  const cancelFn = useRef<{ [key: string]: () => any }>();

  // 线程数量
  const THREAD_COUNT_REF = useRef(0);
  const CHUNK_SIZE = 5 * 1024 * 1024;

  useEffect(() => {
    const threadCount = navigator.hardwareConcurrency || 4;
    for (let i = 0; i < threadCount; i++) {
      const testWorker = new TestWorker();
      testWorker.postMessage(1);
      testWorker.onmessage = () => {
        THREAD_COUNT_REF.current++;
        testWorker.terminate();
      };
    }
  }, []);

  async function checkChunk({
    index,
    fileHash,
    chunksHash,
    fileName,
    fileSize,
  }: ChunkCheckFnParams) {
    const percentComplete = (1 / chunksHash.length) * 100;

    // 当前选择文件的下标
    const curIndex = Object.keys(fileListStatus).length;

    return await fetch("http://localhost:3000/upload/check", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        index,
        chunkHash: chunksHash[index],
        fileName,
        fileHash,
      }),
    })
      .then((res) => res.json())
      .then((res) => {
        // 当取消函数不存在，则表示该上传已经取消，不更新进度条（处理竞态bug）
        if (!cancelFn.current?.[fileHash + curIndex]) return;

        // 当res.data为true的时候更新进度条，这里返回值需要和后端协商
        if (res.data) {
          // 更新进度条
          setFileListStatus((preState) => {
            return {
              ...preState,
              [fileHash + curIndex]: {
                index: curIndex,
                fileName,
                size: fileSize,
                percent:
                  (preState[fileHash + curIndex]?.percent ?? 0) +
                  percentComplete,
              },
            };
          });
          return res.data;
        }
      });
  }

  async function uploadFile({
    fileChunk,
    index,
    fileHash,
    chunksHash,
    fileName,
    fileSize,
  }: ChunkUploadFnParams) {
    const percentComplete = (1 / chunksHash.length) * 100;

    const formData = new FormData();
    formData.append("fileChunk", fileChunk, fileName);
    formData.append("fileName", fileName);
    formData.append("chunkHash", chunksHash[index]);
    formData.append("index", index + "");
    formData.append("chunksCount", chunksHash.length + "");
    formData.append("fileHash", fileHash);

    // 当前选择文件的下标
    const curIndex = Object.keys(fileListStatus).length;

    return fetch("http://localhost:3000/upload", {
      method: "POST",
      body: formData,
    })
      .then((res) => res.json())
      .then(() => {
        // 当取消函数不存在，则表示该上传已经取消，不更新进度条（处理竞态bug）
        if (!cancelFn.current?.[fileHash + curIndex]) return;

        // 更新进度条
        setFileListStatus((preState) => {
          return {
            ...preState,
            [fileHash + curIndex]: {
              index: curIndex,
              fileName,
              size: fileSize,
              percent:
                (preState[fileHash + curIndex]?.percent ?? 0) + percentComplete,
            },
          };
        });
        return fileHash + "-" + index;
      });
  }

  const selectFileHandle = async (e: ChangeEvent<HTMLInputElement>) => {
    const startTime = performance.now();
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);

    const { limitConcurrentRequests, pause, resume, cancel } =
      createRequestManager();

    // 计算分片hash
    const chunksHash = await workerCalculateHash(file, {
      threadCount: THREAD_COUNT_REF.current,
      chunkSize: CHUNK_SIZE,
    });

    // 计算文件hash
    const fileHash = await workerCalculateHash(chunksHash.toString());

    const endTime = performance.now();
    console.log(`Execution time: ${endTime - startTime} milliseconds`);

    // 生成每个分片的请求函数
    const chunkUpload: RequestTask = [];

    for (let i = 0, j = 0; i < file.size; i += CHUNK_SIZE, j++) {
      const outerCheckChunkFn = (params: ChunkCheckFnParams) => () =>
        checkChunk(params);

      const outerUploadChunkFn = (params: ChunkUploadFnParams) => () =>
        uploadFile(params);

      chunkUpload.push([
        outerCheckChunkFn({
          fileName: file.name,
          index: j,
          fileHash,
          chunksHash,
          fileSize: file.size,
        }),
        outerUploadChunkFn({
          fileName: file.name,
          fileChunk: file.slice(i, i + CHUNK_SIZE),
          index: j,
          fileSize: file.size,
          fileHash,
          chunksHash,
        }),
      ]);
    }

    // 当前选择文件的下标
    const curIndex = Object.keys(fileListStatus).length;

    setLoading(false);

    const KEY = fileHash + curIndex;

    // 通过并发控制函数发起请求
    limitConcurrentRequests(chunkUpload, 2, {
      onPaused: () => {
        console.log("onPaused");
        setIsPaused((preState) => ({
          ...preState,
          [KEY]: true,
        }));
      },
      onResumed: () => {
        console.log("onResumed");
        setIsPaused((preState) => ({
          ...preState,
          [KEY]: false,
        }));
      },
      onCanceled: () => {
        console.log("onCanceled");
      },
      onCompleted: (res) => {
        console.log("res", res);
      },
    });

    pauseFn.current = {
      ...pauseFn.current,
      [KEY]: () => {
        pause();
      },
    };

    resumeFn.current = {
      ...resumeFn.current,
      [KEY]: () => {
        resume();
      },
    };

    cancelFn.current = {
      ...cancelFn.current,
      [KEY]: () => {
        cancel();
      },
    };
  };

  return (
    <div className="mt-40 w-fit m-auto">
      {loading && <Loading />}
      <BallMoveAnimation />
      <div className="mb-8">
        worker：
        <input type="file" onChange={selectFileHandle} />
      </div>
      <div className="my-2">
        {Object.keys(fileListStatus)?.map((key) => (
          <div key={key} className="mt-2">
            <div> {`文件名：${fileListStatus[key].fileName}`}</div>
            <div>{`文件大小：${formatFileSize(fileListStatus[key].size)}`}</div>
            <div className="flex">
              <Progress
                className="w-[100%]"
                percent={Math.ceil(fileListStatus[key].percent)}
              />
              <span
                className="ml-2 whitespace-nowrap border px-1 cursor-pointer"
                onClick={async () => {
                  isPaused?.[key]
                    ? resumeFn.current?.[key]()
                    : pauseFn.current?.[key]();
                }}
              >
                {isPaused?.[key] ? "开始" : "暂停"}
              </span>
              <span
                className="ml-2 whitespace-nowrap border px-1 cursor-pointer"
                onClick={() => {
                  cancelFn.current?.[key]();
                  delete cancelFn.current?.[key];
                  setFileListStatus((prevState) => {
                    const newState = { ...prevState };
                    delete newState[key];
                    return newState;
                  });
                }}
              >
                取消
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
