import ipaddress
import json
import socket
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from yt_dlp import YoutubeDL


def safe_public_url(raw):
    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    host = parsed.hostname.lower()
    if host in ("localhost", "localhost.localdomain") or host.endswith(".local"):
        return False
    try:
        for info in socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                return False
    except Exception:
        return False
    return True


def choose_progressive(info):
    formats = info.get("formats") or []
    candidates = []
    for fmt in formats:
        url = fmt.get("url")
        if not url or not str(url).startswith(("http://", "https://")):
            continue
        if fmt.get("vcodec") == "none" or fmt.get("acodec") == "none":
            continue
        protocol = str(fmt.get("protocol") or "")
        if protocol and not any(x in protocol for x in ("http", "https", "m3u8")):
            continue
        height = int(fmt.get("height") or 0)
        ext_bonus = 2 if fmt.get("ext") == "mp4" else 0
        codec_bonus = 1 if "avc" in str(fmt.get("vcodec") or "").lower() else 0
        within = 1 if height <= 1080 else 0
        candidates.append(((within, min(height, 1080), ext_bonus, codec_bonus, int(fmt.get("tbr") or 0)), fmt))
    if candidates:
        candidates.sort(key=lambda x: x[0], reverse=True)
        return candidates[0][1]
    if info.get("url") and str(info.get("url")).startswith(("http://", "https://")):
        return info
    return None


class handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        query = parse_qs(urlparse(self.path).query)
        raw = (query.get("url") or [""])[0].strip()
        if not raw or not safe_public_url(raw):
            return self._send(400, {"error": "Use a public http/https video URL."})
        try:
            options = {
                "quiet": True,
                "no_warnings": True,
                "skip_download": True,
                "noplaylist": True,
                "socket_timeout": 10,
                "extractor_retries": 1,
                "fragment_retries": 1,
                "format": "best[acodec!=none][vcodec!=none]/best",
            }
            with YoutubeDL(options) as ydl:
                info = ydl.extract_info(raw, download=False)
            if info and info.get("_type") in ("playlist", "multi_video"):
                entries = [x for x in (info.get("entries") or []) if x]
                info = entries[0] if entries else None
            if not info:
                return self._send(422, {"error": "No playable video was found at this URL."})
            selected = choose_progressive(info)
            if not selected:
                return self._send(422, {"error": "This source does not expose a single playable audio+video stream. Try uploading the file instead."})
            direct = str(selected.get("url") or "")
            if not safe_public_url(direct):
                return self._send(422, {"error": "The resolved video URL is not safe to fetch."})
            return self._send(200, {
                "url": direct,
                "title": info.get("title") or info.get("fulltitle") or "Video",
                "duration": info.get("duration") or selected.get("duration"),
                "extractor": info.get("extractor_key") or info.get("extractor"),
                "format": selected.get("format_id"),
            })
        except Exception as exc:
            text = str(exc)
            if "Unsupported URL" in text:
                message = "This video site is not supported yet. Try a direct video URL or upload the file."
            elif "Sign in" in text or "login" in text.lower() or "cookies" in text.lower():
                message = "This source currently requires a signed-in session. Upload the video file instead."
            else:
                message = "ClipForge could not retrieve this video URL. The site may have changed; try again or upload the file."
            return self._send(422, {"error": message})

    def log_message(self, format, *args):
        return
