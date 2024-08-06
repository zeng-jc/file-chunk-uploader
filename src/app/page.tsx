"use client";
import SparkMD5 from "spark-md5";
import BallMoveAnimation from "./components/ballMoveAnimation";

export default function Home() {
  // 文件切片
  function createChunks(file: File, chunkSize = 10 * 1024 * 1024) {
    const chunks: Blob[] = [];
    for (let i = 0; i < file.size; i += chunkSize) {
      chunks.push(file.slice(i, i + chunkSize));
    }
    return chunks;
  }
  // 增量计算文件hash，而不是一次性将整个文件加载到内存中计算，防止内存撑爆
  function calculateFileHash(chunks: Blob[]) {
    const spark = new SparkMD5.ArrayBuffer();
    return new Promise((resolve, reject) => {
      function _recursionRead(i: number) {
        if (i >= chunks.length) {
          resolve(spark.end());
          return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
          const bytes = event.target?.result; // 字节数组
          if (!bytes) return;
          spark.append(bytes as ArrayBuffer);
          _recursionRead(i + 1);
        };
        reader.readAsArrayBuffer(chunks[i]);
        reader.onerror = reject;
      }
      _recursionRead(0);
    });
  }
  // 交给worker计算hash值
  async function workerCalculateHash(file: File): Promise<string[]>;
  async function workerCalculateHash(file: string): Promise<string>;
  async function workerCalculateHash(
    file: File | string
  ): Promise<string[] | string> {
    const { default: WorkerModule } = (await import(
      "../workers/file.worker"
    )) as typeof import("worker-loader!*");
    return new Promise((resolve, reject) => {
      if (typeof file === "string") {
        const worker = new WorkerModule();
        worker.postMessage({ file });
        return (worker.onmessage = (event) => {
          resolve(event.data);
          worker.terminate();
        });
      }

      let finishThreadCount = 0;
      const result: string[] = [];
      const chunkSize = 5 * 1024 * 1024; // 切片大小
      const threadCount = navigator.hardwareConcurrency || 2; // 线程数量
      const chunkCount = Math.ceil(file.size / chunkSize); // 切片总数
      const threadChunkCount = Math.ceil(chunkCount / threadCount); // 线程的切片数量

      for (let i = 0; i < threadCount; i++) {
        const worker = new WorkerModule();
        const start = i * threadChunkCount;
        let end = (i + 1) * threadChunkCount;
        if (end > chunkCount) return (end = chunkCount);
        worker.postMessage({
          file,
          start,
          end,
          chunkSize,
        });
        worker.onmessage = (event) => {
          result[i] = event.data;
          worker.terminate();
          if (++finishThreadCount === threadCount) resolve(result.flat());
        };
        worker.onerror = reject;
      }
    });
  }

  function uploadFile({
    chunk,
    chunksTotal,
    index,
    fileHash,
    chunksHash,
    fileName,
  }: {
    chunk: Blob; // 切片
    chunksTotal: number; // 总切片数量
    index: number; // 切片索引
    chunksHash: string[]; // 切片hash
    fileHash: string; // 文件hash
    fileName: string; // 文件名
  }) {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.set("fileName", fileName);
    formData.set("chunk", chunk);
    formData.set("chunkHash", chunksHash[index]);
    formData.set("index", index + "");
    formData.set("chunksTotal", chunksTotal + "");
    formData.set("fileHash", fileHash);

    xhr.upload.onprogress = function (event) {
      if (event.lengthComputable) {
        const percentComplete = (event.loaded / event.total) * 100;
      }
    };
    xhr.onload = function () {
      if (xhr.status === 200) {
        console.log("Upload complete!");
      } else {
        console.error("Upload failed.");
      }
    };
    xhr.open("POST", "/upload", true);
    xhr.send(formData);
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
            console.log("chunks", chunks);
            const hash = await calculateFileHash(chunks);
            console.log("hash", hash);
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
            console.log("select file", e.target.files?.[0]);
            const chunksHash = await workerCalculateHash(e.target.files?.[0]!);
            const fileHash = await workerCalculateHash(chunksHash.toString());
            console.log("hash", chunksHash, fileHash);
            const endTime = performance.now();
            console.log(`Execution time: ${endTime - startTime} milliseconds`);
          }}
        />
      </div>
    </div>
  );
}
