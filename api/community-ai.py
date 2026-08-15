import json
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

OVH_URL = "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions"
OVH_MODELS = ["Meta-Llama-3_3-70B-Instruct", "Qwen3-32B", "Mistral-Nemo-Instruct-2407"]
ANDY_URL = "https://andy.mindcraft-ce.com/api/v1/chat/completions"
HORDE_ASYNC = "https://aihorde.net/api/v2/generate/text/async"
HORDE_STATUS = "https://aihorde.net/api/v2/generate/text/status/{}"


def request_json(url, body=None, headers=None, timeout=9):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST" if body is not None else "GET")
    req.add_header("Accept", "application/json")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def text_from_openai(data):
    try:
        return str(data["choices"][0]["message"]["content"]).strip()
    except Exception:
        return ""


def try_ovh(prompt):
    # Rotate the first choice so one anonymous model limit does not become a single point of failure.
    offset = int(time.time() // 30) % len(OVH_MODELS)
    models = OVH_MODELS[offset:] + OVH_MODELS[:offset]
    for model in models:
        try:
            data = request_json(OVH_URL, {
                "model": model,
                "messages": [
                    {"role": "system", "content": "Return only valid JSON. Do not add markdown fences."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.15,
                "max_tokens": 2200,
                "response_format": {"type": "json_object"},
            }, timeout=8)
            content = text_from_openai(data)
            if content:
                return {"content": content, "provider": "ovh-anonymous", "model": data.get("model") or model}
        except Exception:
            continue
    return None


def try_andy(prompt):
    try:
        data = request_json(ANDY_URL, {
            "model": "sweaterdog/andy-4:latest",
            "messages": [
                {"role": "system", "content": "Return only valid JSON when asked."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.15,
            "max_tokens": 2200,
        }, timeout=8)
        content = text_from_openai(data)
        return {"content": content, "provider": "andy-community", "model": "auto"} if content else None
    except Exception:
        return None


def try_horde(prompt):
    try:
        queued = request_json(HORDE_ASYNC, {
            "prompt": prompt,
            "params": {"max_length": 2200, "temperature": 0.15, "top_p": 0.9, "n": 1},
            "trusted_workers": False,
            "slow_workers": True,
        }, headers={"apikey": "0000000000", "Client-Agent": "ClipForge:4.0:github.com/WynnDev-rill/auto-vid-clipper"}, timeout=8)
        job_id = queued.get("id")
        if not job_id:
            return None
        deadline = time.time() + 18
        while time.time() < deadline:
            time.sleep(2)
            status = request_json(HORDE_STATUS.format(job_id), headers={"apikey": "0000000000", "Client-Agent": "ClipForge:4.0:github.com/WynnDev-rill/auto-vid-clipper"}, timeout=6)
            generations = status.get("generations") or []
            if generations:
                content = str(generations[0].get("text") or "").strip()
                if content:
                    return {"content": content, "provider": "ai-horde-anonymous", "model": generations[0].get("model") or "auto"}
            if status.get("faulted"):
                break
        return None
    except Exception:
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

    def do_POST(self):
        try:
            length = min(int(self.headers.get("content-length") or "0"), 140_000)
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            prompt = str(payload.get("prompt") or "").strip()
            if not prompt:
                return self._send(400, {"error": "prompt is required"})
            if len(prompt) > 120_000:
                prompt = prompt[:120_000]
            for provider in (try_ovh, try_andy, try_horde):
                result = provider(prompt)
                if result:
                    return self._send(200, result)
            return self._send(503, {"error": "All community AI providers are currently unavailable"})
        except Exception:
            return self._send(500, {"error": "Community AI routing failed"})

    def log_message(self, format, *args):
        return
