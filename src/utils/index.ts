type RequestTask = () => Promise<any>;
export function createRequestManager() {
  let paused = false;
  let pauseResolve: (() => void) | null = null;
  let canceled = false;

  const pause = () => {
    paused = true;
    return new Promise<void>((resolve) => {
      pauseResolve = resolve;
    });
  };

  const resume = () => {
    paused = false;
    if (pauseResolve) {
      pauseResolve();
      pauseResolve = null;
    }
  };

  const cancel = () => {
    canceled = true;
  };

  const limitConcurrentRequests = async (
    requestTasks: RequestTask[],
    limit = 4,
    callback: () => void
  ) => {
    const promisesQueue: Promise<any>[] = [];
    const pool = new Set<Promise<any>>();

    for (const request of requestTasks) {
      if (canceled) break;

      if (paused) await pause(); // 等待 resume 调用

      if (pool.size >= limit) {
        await Promise.race(pool).catch((err) => err);
      }

      const promise = requestRetry(request);
      pool.add(promise);
      promisesQueue.push(promise);

      const responseCallback = () => {
        pool.delete(promise);
      };

      promise.then(responseCallback, responseCallback);
    }
    return await Promise.allSettled(promisesQueue).then(callback);
  };

  return { limitConcurrentRequests, pause, resume, cancel };
}

/**
 * 并发请求控制函数
 * @param requestTasks 请求任务
 * @param limit 并发限制
 * @param callback 请求任务全部完成调用
 */
export async function limitConcurrentRequests(
  requestTasks: (() => Promise<any>)[],
  limit = 4,
  callback: () => void
) {
  // 维护一个promise队列
  const promisesQueue = [];
  // 当前并发池
  const pool = new Set();
  // 开始并发执行所有的任务
  for (let request of requestTasks) {
    if (pool.size >= limit) {
      await Promise.race(pool).catch((err) => err);
    }
    const promise = requestRetry(request);
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
