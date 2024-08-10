"use client";
import SparkMD5 from "spark-md5";
import BallMoveAnimation from "./components/ballMoveAnimation";
import Progress from "./components/progress";
import { useEffect, useRef, useState } from "react";
import { createRequestManager } from "@/utils";
import TestWorker from "../workers/test.worker";
import Loading from "./components/Loading/Index";
function formatFileSize(size: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }
  return `${size.toFixed(2)} ${units[index]}`;
}

export default function Home() {
  const [fileListStatus, setFileListStatus] = useState<{
    [key: string]: {
      index: number;
      percent: number;
      fileName: string;
      size: number;
    };
  }>({});
  const [loading, setLoading] = useState(false);
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

  // 文件切片
  function createChunks(file: File, chunkSize = 10 * 1024 * 1024) {
    const chunks: Blob[] = [];
    for (let i = 0; i < file.size; i += chunkSize) {
      chunks.push(file.slice(i, i + chunkSize));
    }
    return chunks;
  }

  // 计算文件切片的hash
  async function calculateChunksHash(chunks: Blob[]) {
    return Promise.all(
      chunks.map(async (chunk) => {
        const bytes = await chunk.arrayBuffer();
        return SparkMD5.ArrayBuffer.hash(bytes);
      })
    );
  }

  // 交给worker计算hash值
  async function workerCalculateHash(
    file: File,
    options: {
      chunkSize: number;
      threadCount: number;
    }
  ): Promise<string[]>;
  async function workerCalculateHash(file: string): Promise<string>;
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
      const threadChunkCount = Math.ceil(chunksCount / threadCount); // 线程的切片数量
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
          start,
          end,
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

  async function uploadFile({
    fileChunk,
    index,
    fileHash,
    chunksHash,
    fileName,
    fileSize,
  }: {
    fileChunk: Blob; // 文件片段
    index: number; // 切片索引
    chunksHash: string[]; // 切片hash
    fileHash: string; // 整个文件hash
    fileName: string; // 文件名
    fileSize: number; // 文件大小
  }) {
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
        if (!cancelFn.current?.[fileHash + curIndex]) return;

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
      });
  }

  return (
    <div className="mt-40 w-fit m-auto">
      {loading && <Loading />}
      <BallMoveAnimation />
      <div className="mb-2">
        主线程：
        <input
          type="file"
          onChange={async (e) => {
            const startTime = performance.now();
            const chunks = createChunks(e.target.files?.[0]!, 10 * 1024 * 1024);
            const hash = await calculateChunksHash(chunks);
            const endTime = performance.now();
            console.log(`Execution time: ${endTime - startTime} milliseconds`);
          }}
        />
      </div>
      <div className="mb-8">
        worker：
        <input
          type="file"
          onChange={async (e) => {
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

            setLoading(false);

            const endTime = performance.now();
            console.log(`Execution time: ${endTime - startTime} milliseconds`);

            // 生成每个分片的请求函数
            const uploadFiles: (() => Promise<any>)[] = [];
            for (let i = 0, j = 0; i < file.size; i += CHUNK_SIZE, j++) {
              const outerFn = (params: any) => () => uploadFile(params); // 利用闭包携带参数
              uploadFiles.push(
                outerFn({
                  fileName: file.name,
                  fileChunk: file.slice(i, i + CHUNK_SIZE),
                  index: j,
                  fileSize: file.size,
                  fileHash,
                  chunksHash,
                })
              );
            }
            // 当前选择文件的下标
            const curIndex = Object.keys(fileListStatus).length;

            // 通过并发控制函数发起请求
            limitConcurrentRequests(uploadFiles, 2, () => {});

            pauseFn.current = {
              ...pauseFn.current,
              [fileHash + curIndex]: async () => {
                await pause();
              },
            };

            resumeFn.current = {
              ...resumeFn.current,
              [fileHash + curIndex]: () => {
                resume();
              },
            };

            cancelFn.current = {
              ...cancelFn.current,
              [fileHash + curIndex]: () => {
                cancel();
              },
            };
          }}
        />
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
                  setIsPaused((preState) => ({
                    ...preState,
                    [key]: !preState?.[key],
                  }));
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
