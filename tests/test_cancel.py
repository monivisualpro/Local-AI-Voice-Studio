"""Stop button: a running generation must end within a moment, health must show live progress,
and generations must run one at a time. Uses a fake engine, so no model or GPU is needed."""
import json, os, sys, threading, time, urllib.request, urllib.error
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
import server
from engines import common


class FakeEngine:
    """Pretends to be a slow model: 40 audio frames per second, 20 s of audio per request."""
    def synthesize(self, req):
        for _ in range(500):
            common.tick()
            time.sleep(0.025)
        return np.zeros(24000, dtype="float32"), 24000

    def voices(self):
        return []


def call(port, path, body=None, timeout=30):
    data = json.dumps(body).encode() if body is not None else b""
    r = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data if body is not None else None,
                               method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def main():
    server.STATE.update(adapter="fake", engine=FakeEngine(), model=object(), loading=False, device="cpu")
    srv = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    out = {}
    def run(name):
        t = time.time()
        out[name] = (call(port, "/synthesize", {"text": "hello"}), time.time() - t)

    t1 = threading.Thread(target=run, args=("a",)); t1.start()
    time.sleep(0.6)
    status, body = call(port, "/health")
    h = json.loads(body)
    assert h["busy"] and h["steps"] > 5, h          # live progress while generating
    assert h["audioSeconds"] > 0, h

    # a second request must wait for the first (no parallel generations)
    t2 = threading.Thread(target=run, args=("b",)); t2.start()
    time.sleep(0.3)

    t0 = time.time()
    assert call(port, "/cancel", {})[0] == 200
    t1.join(5); t2.join(5)
    assert not t1.is_alive() and not t2.is_alive(), "cancel did not stop generation"
    assert out["a"][0][0] == 499 and out["b"][0][0] == 499, out
    assert time.time() - t0 < 2.0, "cancel took too long"

    # the server keeps working after a cancel
    server.STATE["engine"].synthesize = lambda req: (np.zeros(2400, dtype="float32"), 24000)
    status, body = call(port, "/synthesize", {"text": "again"})
    assert status == 200 and body[:4] == b"RIFF", (status, body[:80])
    assert not json.loads(call(port, "/health")[1])["busy"]
    print("test_cancel: OK")


if __name__ == "__main__":
    main()
