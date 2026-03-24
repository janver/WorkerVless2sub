const DEFAULT_UPHOST = "sub.cmliussss.workers.dev";
const UPSTREAM_PATH = "/sub";

const UPSTREAM_PARAMS = {
  host: "edgetunnel-2z2.pages.dev",
  uuid: "30e9c5c8-0000-0000-0000-dc67277f8b02",
  path: "/?ed=2560",
  sni: "www.10068.cn",
  type: "ws",
};

export default {
  async fetch(request) {
    const requestUrl = new URL(request.url);
    const uphosts = parseUpHosts(requestUrl.searchParams.get("uphost"));

    const results = await Promise.allSettled(
      uphosts.map((uphost) => fetchUpstream(uphost)),
    );

    const mergedLines = [];
    const seen = new Set();
    let successCount = 0;

    for (const result of results) {
      if (result.status !== "fulfilled") {
        continue;
      }

      successCount += 1;

      for (const node of result.value) {
        if (seen.has(node.key)) {
          continue;
        }

        seen.add(node.key);
        mergedLines.push(node.line);
      }
    }

    if (successCount === 0) {
      return new Response("upstream request failed", {
        status: 502,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }

    return new Response(mergedLines.join("\n"), {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  },
};

async function fetchUpstream(uphost) {
  const upstreamUrl = buildUpstreamUrl(uphost);
  const response = await fetch(upstreamUrl, {
    headers: {
      "User-Agent": "CF-Workers-Suball/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`upstream ${uphost} returned ${response.status}`);
  }

  const encodedText = (await response.text()).trim();
  const decodedText = decodeBase64Utf8(encodedText);
  return extractNodes(decodedText);
}

function parseUpHosts(rawValue) {
  if (!rawValue) {
    return [DEFAULT_UPHOST];
  }

  const hosts = rawValue
    .split(",")
    .map((item) => normalizeHost(item))
    .filter(Boolean);

  if (hosts.length === 0) {
    return [DEFAULT_UPHOST];
  }

  return [...new Set(hosts)];
}

function normalizeHost(value) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  const withoutProtocol = trimmed.replace(/^https?:\/\//i, "");
  return withoutProtocol.replace(/\/.*$/, "");
}

function buildUpstreamUrl(uphost) {
  const url = new URL(`https://${uphost}${UPSTREAM_PATH}`);

  for (const [key, value] of Object.entries(UPSTREAM_PARAMS)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

function decodeBase64Utf8(value) {
  const normalized = value.replace(/\s+/g, "");
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function extractNodes(decodedText) {
  const lines = decodedText.split(/\r?\n/);
  const nodes = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line || !line.startsWith("vless://")) {
      continue;
    }

    try {
      const url = new URL(line);
      const host = url.hostname;
      const port = url.port || "443";

      if (!host) {
        continue;
      }

      const remark = safeDecode(url.hash.startsWith("#") ? url.hash.slice(1) : "");
      const key = `${host}:${port}`;
      const output = remark ? `${key}#${remark}` : key;

      nodes.push({ key, line: output });
    } catch {
      continue;
    }
  }

  return nodes;
}

function safeDecode(value) {
  if (!value) {
    return "";
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
