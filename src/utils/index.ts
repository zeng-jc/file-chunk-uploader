export type RequestTask = [() => Promise<any>, () => Promise<any>][];

export function createRequestManager() {
  let isPause = false;
  let isCancel = false;

  let pauseResolve: (() => void) | null = null;

  let pauseCallback: (() => void) | undefined;
  let resumeCallback: (() => void) | undefined;
  let cancelCallback: (() => void) | undefined;

  const pause = () => {
    isPause = true;
    pauseCallback?.();
  };

  const resume = () => {
    isPause = false;
    pauseResolve?.();
    pauseResolve = null;
    resumeCallback?.();
  };

  const cancel = () => {
    window.removeEventListener("offline", pause);
    window.removeEventListener("online", resume);
    isCancel = true;
    cancelCallback?.();
  };

  // 监听网络状态变化
  window.addEventListener("online", resume);
  window.addEventListener("offline", pause);

  const limitConcurrentRequests = async (
    requestTasks: RequestTask,
    limit = 4,
    {
      onPaused,
      onResumed,
      onCanceled,
      onCompleted,
    }: {
      onPaused?: (reason?: "offline") => void;
      onResumed?: (reason?: "online") => void;
      onCanceled?: () => void;
      onCompleted?: (reason: PromiseSettledResult<any>[]) => void;
    }
  ) => {
    resumeCallback = onResumed;
    pauseCallback = onPaused;
    cancelCallback = onCanceled;

    const promisesQueue: Promise<any>[] = [];
    const pool = new Set<Promise<any>>();

    for (const [checkRequest, uploadRequest] of requestTasks) {
      if (isCancel) {
        break;
      }

      if (isPause) {
        await new Promise<void>((resolve) => (pauseResolve = resolve)); // 等待 resume 调用
      }

      if (pool.size >= limit) {
        await Promise.race(pool).catch((err) => err);
      }

      const promise = requestRetry(checkRequest)
        .then((res) => {
          if (res) return res;
          return requestRetry(uploadRequest);
        })
        .catch(async (err) => {
          // catch是为了处理断网的场景 和 重试多次还是失败的场景，失败的分片放到最后上传
          requestTasks.push([checkRequest, uploadRequest]);
          return Promise.reject(err);
        });

      pool.add(promise);
      promisesQueue.push(promise);

      const responseCallback = () => {
        pool.delete(promise);
      };

      promise.then(responseCallback, responseCallback);
    }

    const completeCallback = (res: PromiseSettledResult<any>[]) => {
      onCompleted?.(res);
      window.removeEventListener("offline", pause);
      window.removeEventListener("online", resume);
    };

    return await Promise.allSettled(promisesQueue).then(
      completeCallback,
      completeCallback
    );
  };

  return { limitConcurrentRequests, pause, resume, cancel };
}

/**
 *
 * @param request 请求函数
 * @param retryCount 重试次数
 * @returns
 */
export async function requestRetry(
  request: () => Promise<any>,
  retryCount = 1
): Promise<any> {
  return await request().catch((err: any) =>
    retryCount <= 0
      ? Promise.reject(err)
      : requestRetry(request, retryCount - 1)
  );
}

export function formatFileSize(size: number) {
  if (typeof size !== "number") return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }
  return `${size.toFixed(2)} ${units[index]}`;
}

/**
 * 并发请求控制函数
 * @param requestTasks 请求任务
 * @param limit 并发限制
 * @param callback 请求任务全部完成调用
 */
export async function limitConcurrentRequests(
  requestTasks: RequestTask,
  limit = 4,
  callback: () => void
) {
  // 维护一个promise队列
  const promisesQueue = [];
  // 当前并发池
  const pool = new Set();
  // 开始并发执行所有的任务
  for (const [checkRequest, uploadRequest] of requestTasks) {
    if (pool.size >= limit) {
      await Promise.race(pool).catch((err) => err);
    }
    const promise = requestRetry(checkRequest).then((res) => {
      if (res) return res;
      return requestRetry(uploadRequest);
    });
    pool.add(promise);
    promisesQueue.push(promise);
    const responseCallback = () => {
      pool.delete(promise);
    };
    // 无论响应成功还是失败都从并发池中移除
    promise.then(responseCallback, responseCallback);
  }
  return await Promise.allSettled(promisesQueue).then(callback, callback);
}
