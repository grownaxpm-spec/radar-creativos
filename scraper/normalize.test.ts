import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAd, libraryUrl, daysActive } from "./normalize.ts";

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
