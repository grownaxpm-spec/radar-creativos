import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAd, libraryUrl, daysActive, winnerScore } from "./normalize.ts";

test("anuncio de video (camelCase, apify/facebook-ads-scraper)", () => {
  const ad = normalizeAd(
    {
      adArchiveID: "123",
      pageName: "Zapatería Ejemplo",
      isActive: true,
      startDate: 1760000000,
      publisherPlatform: ["FACEBOOK", "INSTAGRAM"],
      snapshot: {
        displayFormat: "VIDEO",
        body: { text: "Botas de cuero hechas a mano" },
        ctaText: "Comprar",
        videos: [{ videoHdUrl: "https://v/hd.mp4", videoSdUrl: "https://v/sd.mp4", videoPreviewImageUrl: "https://v/p.jpg" }],
        images: [],
      },
    },
    "AR",
  )!;
  assert.equal(ad.format, "video");
  assert.equal(ad.media[0].url, "https://v/hd.mp4");
  assert.equal(ad.media[0].thumb, "https://v/p.jpg");
  assert.equal(ad.body, "Botas de cuero hechas a mano");
  assert.deepEqual(ad.publisher_platforms, ["facebook", "instagram"]);
  assert.equal(ad.start_date, "2025-10-09");
  assert.deepEqual(ad.countries, ["AR"]);
});

test("carrusel snake_case con plantilla dinámica", () => {
  const ad = normalizeAd({
    ad_archive_id: "9",
    page_name: "Marca",
    start_date: "2026-01-01",
    snapshot: {
      body: { text: "{{product.brand}}" },
      cards: [
        { original_image_url: "https://i/1.jpg", body: "Mocasín" },
        { original_image_url: "https://i/2.jpg" },
      ],
    },
  })!;
  assert.equal(ad.format, "carousel");
  assert.equal(ad.media.length, 2);
  assert.equal(ad.body, null);
});

test("sin id devuelve null; url y días", () => {
  assert.equal(normalizeAd({ pageName: "x" }), null);
  assert.match(libraryUrl("zapatos de cuero", "ES", "video"), /country=ES.*q=zapatos\+de\+cuero.*media_type=video/);
  assert.equal(daysActive({ start_date: "2026-01-01", end_date: "2026-01-31" }), 30);
});

test("puntaje: más días y más variaciones = más alto", () => {
  const today = new Date("2026-11-19");
  const base = { is_active: true, countries: ["AR"], publisher_platforms: ["facebook"], end_date: null };
  const nuevo = winnerScore({ ...base, start_date: "2026-11-15", variations: 1 }, null, today);
  const viejo = winnerScore({ ...base, start_date: "2026-08-01", variations: 1 }, null, today);
  const escalado = winnerScore({ ...base, start_date: "2026-08-01", variations: 8, publisher_platforms: ["facebook", "instagram"] }, null, today);
  assert.ok(nuevo < viejo && viejo < escalado, `${nuevo} < ${viejo} < ${escalado}`);
  assert.ok(escalado <= 100);
});

test("variaciones desde collationCount", () => {
  const ad = normalizeAd({ adArchiveID: "5", collationCount: 4, snapshot: { images: [{ originalImageUrl: "https://i/x.jpg" }] } })!;
  assert.equal(ad.variations, 4);
});

import { rubroRoots, matchesRubro } from "./normalize.ts";
test("filtro de rubro descarta apps de idiomas y deja calzado", () => {
  const roots = rubroRoots(["zapatos de cuero hombre", "botas de cuero hombre", "Calzado y marroquinería de cuero para hombre"]);
  const base = { title: null, link_url: null };
  assert.ok(matchesRubro({ ...base, body: "Zapatillas urbanas 100% cuero vacuno", page_name: "X" }, roots));
  assert.ok(matchesRubro({ ...base, body: "Nuevos mocasines", page_name: "Giorgio Beneti" }, roots, ["Giorgio Beneti"]));
  assert.ok(!matchesRubro({ ...base, body: "Aprendé inglés leyendo 10 minutos por día", page_name: "EWA: Learn Languages" }, roots));
  assert.ok(!matchesRubro({ ...base, body: "Nunca había estado tan cerca de ella", page_name: "Caliente-Romance" }, roots));
});

import { sniffImage } from "./classify.ts";
test("detecta el tipo real de imagen por sus bytes", () => {
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])), "image/png");
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])), "image/jpeg");
  assert.equal(sniffImage(new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0, 0, 0, 0, 0, 0, 0, 0])), null);
});
