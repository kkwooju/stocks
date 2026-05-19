"""
Portfolio launcher - silent background HTTP server.

Behavior:
  * No console window (PyInstaller --noconsole).
  * Opens portfolio.html in the default browser on start.
  * Auto-terminates when the page is closed:
      - /heartbeat ping every 5s from the page; if missing for >15s, server shuts down.
      - /shutdown beacon sent by the page on pagehide for instant termination.
"""
import http.server
import socketserver
import webbrowser
import threading
import time
import os
import sys
import socket


# ---------------------------------------------------------------
# --noconsole safety: sys.stdout / sys.stderr are None in windowed mode
# Any print() or library log call would AttributeError. Patch with a sink.
# ---------------------------------------------------------------
class _NullIO:
    def write(self, *_): pass
    def flush(self): pass
    def isatty(self): return False


if sys.stdout is None:
    sys.stdout = _NullIO()
if sys.stderr is None:
    sys.stderr = _NullIO()


HEARTBEAT_TIMEOUT_S = 15        # 마지막 heartbeat 후 이 시간 지나면 종료
HEARTBEAT_GRACE_S = 30          # 페이지 첫 로드까지 대기 (브라우저가 늦게 떠도 OK)
MONITOR_TICK_S = 2

# 공유 상태 (스레드간) — list로 감싸 가변 참조
last_heartbeat = [time.time() + HEARTBEAT_GRACE_S]  # 시작 시 grace 만큼 미래로
shutdown_requested = [False]


def find_free_port(start=8765, end=8800):
    for p in range(start, end):
        s = socket.socket()
        try:
            s.bind(("127.0.0.1", p))
            s.close()
            return p
        except OSError:
            s.close()
    return None


class Handler(http.server.SimpleHTTPRequestHandler):
    # 콘솔에 로그 안 찍음 (noconsole에서 stdout/stderr 안전 + 성능)
    def log_message(self, *_args, **_kwargs):
        pass

    def _no_cache(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")

    def do_GET(self):
        if self.path.startswith("/heartbeat"):
            last_heartbeat[0] = time.time()
            self.send_response(204)
            self._no_cache()
            self.end_headers()
            return
        # 정적 파일 응답에도 캐시 안 함 (사용자가 새로고침 안 해도 새 버전 보이게)
        super().do_GET()

    def end_headers(self):
        # 정적 파일 응답 헤더에 캐시 비활성 추가
        if self.path and not self.path.startswith("/heartbeat"):
            self._no_cache()
        super().end_headers()

    def do_POST(self):
        if self.path.startswith("/shutdown"):
            shutdown_requested[0] = True
            try:
                # 응답 본문 폐기 (sendBeacon이 보내는 빈 바디 등)
                length = int(self.headers.get("Content-Length", "0") or 0)
                if length:
                    self.rfile.read(length)
            except Exception:
                pass
            self.send_response(204)
            self._no_cache()
            self.end_headers()
            return
        self.send_response(404)
        self.end_headers()


def monitor_loop(server):
    """heartbeat 끊김 감지 → 서버 종료"""
    while True:
        if shutdown_requested[0]:
            break
        if time.time() - last_heartbeat[0] > HEARTBEAT_TIMEOUT_S:
            break
        time.sleep(MONITOR_TICK_S)
    # 별도 스레드에서 호출해야 함 (handler 내부에서 server.shutdown()은 데드락)
    try:
        server.shutdown()
    except Exception:
        pass


def main():
    base_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
    os.chdir(base_dir)

    if not os.path.exists(os.path.join(base_dir, "portfolio.html")):
        # noconsole이라 print를 안 보이지만 메시지박스 없이도 조용히 종료
        return

    port = find_free_port()
    if port is None:
        return

    url = "http://localhost:{}/portfolio.html".format(port)

    def open_browser():
        time.sleep(1.0)
        try:
            webbrowser.open(url)
        except Exception:
            pass

    threading.Thread(target=open_browser, daemon=True).start()

    server = socketserver.ThreadingTCPServer(("127.0.0.1", port), Handler)
    server.allow_reuse_address = True

    monitor = threading.Thread(target=monitor_loop, args=(server,), daemon=True)
    monitor.start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        try:
            server.server_close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
