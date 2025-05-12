import { Hono } from "hono";
import type { FC } from "hono/jsx";
import { stream } from "hono/streaming";
import { lookup as mimeLookup } from "mime-types";
import { basicAuth } from "hono/basic-auth";

const username = Bun.env.BASIC_AUTH_USER!;
const password = Bun.env.BASIC_AUTH_PASS!;

const authMiddleware = basicAuth({
  username,
  password,
});

const shlinkApi = Bun.env.SHLINK_API;
const shlinkApiKey = Bun.env.SHLINK_API_KEY;
const fullHost = Bun.env.FULL_HOST;

const app = new Hono();

const Layout: FC = (props) => {
  return (
    <html>
      <body>{props.children}</body>
    </html>
  );
};

const Top: FC = () => {
  return (
    <Layout>
      <h1>Upload a file</h1>
      <form action="/upload" method="post" enctype="multipart/form-data">
        <input type="file" name="file" required />
        <button type="submit">Upload</button>
      </form>
    </Layout>
  );
};

app.get("/", authMiddleware, (c) => {
  return c.html(<Top />);
});

app.post("/upload", authMiddleware, async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File;
  if (file) {
    const fileName = file.name;
    const fileSize = file.size;
    // store in /data
    const uid = crypto.randomUUID();
    const slug = `${uid}-${fileName}`;
    const filePath = `./data/${slug}`;
    await Bun.write(filePath, await file.arrayBuffer());

    const fileUrl = `${fullHost}/file/${slug}`;
    const shlinkRes = await fetch(`${shlinkApi}/rest/v3/short-urls`, {
      method: "POST",
      headers: {
        "X-Api-Key": shlinkApiKey!,
      },
      body: JSON.stringify({
        longUrl: fileUrl,
        tags: ["quick-share-file"],
      }),
    });

    const shlinkBody = await shlinkRes.json();
    const shortUrl = shlinkBody.shortUrl;

    return c.html(
      <Layout>
        <h1>File uploaded</h1>
        <a href={shortUrl}>{shortUrl}</a>
        <p>{shortUrl}</p>
        <p>Long URL: {fileUrl}</p>
      </Layout>
    );

    // create a short link
  }
  return c.text("No file uploaded", 400);
});

// will return the file directly
app.get("/file/:uid", async (c) => {
  const uid = c.req.param("uid");
  if (!/^[\w\-\.]+$/.test(uid)) {
    return c.text("Invalid file name", 400);
  }
  const filePath = `./data/${uid}`;
  try {
    const file = await Bun.file(filePath).stat();
    if (file) {
      const fileStream = Bun.file(filePath).stream();
      const contentType = mimeLookup(filePath) || "application/octet-stream";
      c.res.headers.set("Content-Type", contentType);
      c.res.headers.set("Content-Disposition", `inline; filename="${uid}"`);
      c.res.headers.set("Content-Length", file.size.toString());
      return stream(c, async (stream) => {
        const reader = fileStream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          stream.write(value);
        }
        stream.close();
      });
    }
  } catch (e) {
    return c.text("File not found", 404);
  }
});

export default app;
