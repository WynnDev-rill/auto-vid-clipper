import fs from "node:fs";

export async function uploadVideoToYouTube(input: {
  accessToken: string;
  filePath: string;
  title: string;
  description: string;
  visibility: "public" | "unlisted" | "private";
}) {
  const size = fs.statSync(input.filePath).size;
  const init = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(size),
      },
      body: JSON.stringify({
        snippet: {
          title: input.title.slice(0, 100),
          description: input.description.slice(0, 5000),
          tags: ["shorts", "clipforge"],
          categoryId: "22",
        },
        status: {
          privacyStatus: input.visibility,
          selfDeclaredMadeForKids: false,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!init.ok) {
    throw new Error(`YouTube upload init ${init.status}: ${(await init.text()).slice(0, 300)}`);
  }
  const location = init.headers.get("location");
  if (!location) throw new Error("YouTube did not return a resumable upload URL");

  const video = fs.readFileSync(input.filePath);
  const uploaded = await fetch(location, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(video.byteLength),
    },
    body: video,
    signal: AbortSignal.timeout(180_000),
  });
  if (!uploaded.ok) {
    throw new Error(`YouTube upload ${uploaded.status}: ${(await uploaded.text()).slice(0, 300)}`);
  }
  const data = (await uploaded.json()) as { id?: string };
  if (!data.id) throw new Error("YouTube upload completed without a video ID");
  return data.id;
}
