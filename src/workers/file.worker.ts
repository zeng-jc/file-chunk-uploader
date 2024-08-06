import SparkMD5 from "spark-md5";

interface FileParams {
  file: File;
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
function createChunks({ file, start, end, chunkSize }: FileParams) {
  const chunks: Blob[] = [];
  for (let i = start; i < end; i++) {
    chunks.push(file.slice(i, i + chunkSize));
  }
  return chunks;
}

// 计算切片的hash
const calculateChunksHash = async (chunks: Blob[]): Promise<string[]> => {
  const chunksHash = [];
  for (let i = 0; i < chunks.length; i++) {
    const bytes = await getArrayBuffer(chunks[i]);
    const hash = SparkMD5.ArrayBuffer.hash(bytes);
    chunksHash.push(hash);
  }
  return chunksHash;
};

self.addEventListener("message", async ({ data }: { data: FileParams }) => {
  try {
    const { file, start, end, chunkSize } = data;
    const chunks = createChunks({ file, start, end, chunkSize });
    const chunksHash = await calculateChunksHash(chunks);
    postMessage(chunksHash);
  } catch (error) {
    console.error("Worker Error: ", error);
  }
});

export {};
