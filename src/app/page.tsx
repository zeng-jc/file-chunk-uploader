"use client";
import SparkMD5 from "spark-md5";
import BallMoveAnimation from "./components/ballMoveAnimation";
import Progress from "./components/progress";
import { useEffect, useRef, useState } from "react";
import { limitConcurrentRequests } from "@/utils";
import TestWorker from "../workers/test.worker";

export default function Home() {
  const [fileListStatus, setFileListStatus] = useState<{
    [key: string]: { index: number; percent: number };
  }>({});

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
      let finishThreadCount = 0;
      const result: string[] = [];
      const chunksCount = Math.ceil(file.size / chunkSize); // 切片总数
      const threadChunkCount = Math.ceil(chunksCount / threadCount); // 线程的切片数量
      const createWorkerCount =
        chunksCount < threadCount ? chunksCount : threadCount;
      console.log(createWorkerCount);
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
  }: {
    fileChunk: Blob; // 文件片段
    index: number; // 切片索引
    chunksHash: string[]; // 切片hash
    fileHash: string; // 整个文件hash
    fileName: string; // 文件名
  }) {
    const percentComplete = (1 / chunksHash.length) * 100;
    const formData = new FormData();
    formData.append("fileChunk", fileChunk, fileName);
    formData.append("fileName", fileName);
    formData.append("chunkHash", chunksHash[index]);
    formData.append("index", index + "");
    formData.append("chunksCount", chunksHash.length + "");
    formData.append("fileHash", fileHash);

    return fetch("http://localhost:3000/upload", {
      method: "POST",
      body: formData,
    })
      .then((res) => res.json())
      .then((data) => {
        setFileListStatus((preState) => ({
          ...preState,
          [fileHash]: {
            index: preState[fileHash]?.index ?? 0,
            percent: (preState[fileHash]?.percent ?? 0) + percentComplete,
          },
        }));
      });
  }

  return (
    <div className="mt-40 w-fit m-auto">
      <BallMoveAnimation />
      <div>
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
      <br />
      <div>
        worker：
        <input
          type="file"
          onChange={async (e) => {
            const startTime = performance.now();
            const file = e.target.files?.[0];
            if (!file) return;
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
            const uploadFiles: (() => Promise<any>)[] = [];
            for (let i = 0, j = 0; i < file.size; i += CHUNK_SIZE, j++) {
              // 利用闭包携带参数
              const outerFn = (params: any) => () => uploadFile(params);
              uploadFiles.push(
                outerFn({
                  fileName: file.name,
                  fileChunk: file.slice(i, i + CHUNK_SIZE),
                  index: j,
                  fileHash,
                  chunksHash,
                })
              );
            }
            // 通过并发控制函数发起请求
            limitConcurrentRequests(uploadFiles, 4, () => {});
          }}
        />
      </div>
      <div className="my-2">
        {Object.keys(fileListStatus)?.map((key) => (
          <Progress
            key={key}
            percent={parseInt(fileListStatus[key].percent.toFixed(0))}
          />
        ))}
      </div>
    </div>
  );
}
