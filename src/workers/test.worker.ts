self.addEventListener("message", () => {
  postMessage(1);
  self.close();
});

export default class TestWorker extends Worker {
  constructor() {
    super("");
  }
}
