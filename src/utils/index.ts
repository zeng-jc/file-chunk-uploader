/**
 * 并发请求控制函数
 * @param requestTasks 请求任务
 * @param limit 并发限制
 * @param callback 请求任务全部完成调用
 */
async function limitConcurrentRequests(
  requestTasks: (() => Promise<any>)[],
  limit = 4,
  callback: () => void
) {
  // 维护一个promise队列
  const promises = [];
  // 当前的并发池
  const pool = new Set();
  // 开始并发执行所有的任务
  for (let request of requestTasks) {
    if (pool.size >= limit) {
      await Promise.race(pool).catch((err) => err);
    }
    const promise = request(); 
    // 删除请求结束后，从pool里面移除
    const cb = () => {
      pool.delete(promise);
    };
    // 注册下then的任务
    promise.then(cb, cb);
    pool.add(promise);
    promises.push(promise);
  }
  Promise.allSettled(promises).then(callback, callback);
}
