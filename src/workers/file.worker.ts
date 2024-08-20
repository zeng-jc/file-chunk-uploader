import SparkMD5 from "spark-md5";

interface FileParams {
  file: File | string;
  start: number;
  end: number;
  chunkSize: number;
}

async function getArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") {
    // 如果支持 arrayBuffer() 方法
    return blob.arrayBuffer();
  } else {
    // 使用 FileReader 作为回退方案
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        resolve(event.target?.result as ArrayBuffer);
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
  }
}

// 文件切片
function createChunks({
  file,
  start,
  end,
  chunkSize,
}: Omit<FileParams, "file"> & { file: File }) {
  const chunks: Blob[] = [];
  for (let i = start; i < end; i += chunkSize) {
    const blob = file.slice(i, i + chunkSize);
    if (blob.size === 0) continue;
    chunks.push(blob);
  }
  return chunks;
}

// 计算hash
async function calculateHash(chunks: string): Promise<string>;
async function calculateHash(chunks: Blob[]): Promise<string[]>;
async function calculateHash(
  chunks: Blob[] | string
): Promise<string[] | string> {
  if (typeof chunks === "string") {
    return Promise.resolve(SparkMD5.hash(chunks));
  }
  return await Promise.all(
    chunks.map(async (chunk) => {
      const bytes = await getArrayBuffer(chunk);
      const hash = SparkMD5.ArrayBuffer.hash(bytes);
      return hash;
    })
  );
}

self.addEventListener("message", async ({ data }: { data: FileParams }) => {
  try {
    const { file, start, end, chunkSize } = data;
    if (typeof file === "string") return postMessage(await calculateHash(file));
    const chunks = createChunks({ file, start, end, chunkSize });
    const chunksHash = await calculateHash(chunks);
    postMessage(chunksHash);
    self.close();
  } catch (error) {
    console.error("Worker Error: ", error);
  }
});

export default class fileWorker extends Worker {
  constructor() {
    super("");
  }
}
