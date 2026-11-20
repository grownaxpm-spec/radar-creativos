import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceUrlOf } from "./apify.ts";
import { libraryUrl } from "./normalize.ts";

test("cada anuncio sabe de qué búsqueda vino", () => {
  const a = libraryUrl("zapatos de cuero", "AR", "all");
  const b = libraryUrl("botas", "ES", "all");
  assert.equal(sourceUrlOf({ inputUrl: b }, [a, b]), b);
  assert.equal(sourceUrlOf({ url: "https://www.facebook.com/ads/library/?id=1" }, [a, b]), null);
  // mismos parámetros en otro orden
  const reordered = "https://www.facebook.com/ads/library/?q=botas&country=ES&active_status=active";
  assert.equal(sourceUrlOf({ inputUrl: reordered }, [a, b]), b);
});
