// Moje cviky – Cloudflare Worker
// Statické soubory obsluhuje ASSETS, worker běží jen pro /api/*.
// /api/youtube?ids=ID1,ID2,list:PLAYLIST  →  {"ID1":"ok","ID2":"smazano",...}
//   ok        = video existuje a jde přehrát v aplikaci
//   jen-yt    = video existuje, ale autor nepovolil přehrávání mimo YouTube
//   smazano   = video neexistuje / je soukromé
//   nevim     = kontrola se nepovedla (nic neschovávat)

const DEN = 60 * 60 * 24;

async function zkontroluj(id, ctx) {
  const cache = caches.default;
  const klic = new Request("https://kontrola.local/yt/" + encodeURIComponent(id));
  const ulozeno = await cache.match(klic);
  if (ulozeno) return await ulozeno.text();

  const cil = id.startsWith("list:")
    ? "https://www.youtube.com/playlist?list=" + id.slice(5)
    : "https://www.youtube.com/watch?v=" + id;
  let stav = "nevim";
  try {
    const r = await fetch("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(cil), {
      headers: { "user-agent": "Mozilla/5.0 (kontrola dostupnosti videa)" },
    });
    if (r.status === 200) stav = "ok";
    else if (r.status === 401 || r.status === 403) stav = "jen-yt";
    else if (r.status === 404 || r.status === 400) stav = "smazano";
  } catch (e) {
    stav = "nevim";
  }
  if (stav !== "nevim") {
    ctx.waitUntil(cache.put(klic, new Response(stav, { headers: { "cache-control": "max-age=" + DEN } })));
  }
  return stav;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/youtube") {
      const ids = (url.searchParams.get("ids") || "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^(list:)?[\w-]{6,64}$/.test(s))
        .slice(0, 100);
      const vysledky = await Promise.all(ids.map((id) => zkontroluj(id, ctx)));
      const out = {};
      ids.forEach((id, i) => (out[id] = vysledky[i]));
      return new Response(JSON.stringify(out), {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
