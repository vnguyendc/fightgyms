"""Offline tests for the photo scraper's pure parts: html candidate extraction and image prep.
No network, no model, no database."""
import io
import unittest

from PIL import Image

from scrapers.fetch_photos import extract_candidates, find_gallery_url, prepare

BASE = "https://example-gym.com/"

HTML = """
<html><head>
<meta property="og:image" content="/img/og-hero.jpg">
<meta name="twitter:image" content="https://cdn.example-gym.com/tw.jpg">
</head><body>
<a href="/about">about</a> <a href="/gallery">photos</a> <a href="https://other.com/gallery">x</a>
<img src="/img/logo.png" alt="logo">
<img src="/img/icon-32.svg">
<img src="data:image/png;base64,AAAA">
<img src="/img/mats-small.jpg" srcset="/img/mats-400.jpg 400w, /img/mats-1200.jpg 1200w, /img/mats-800.jpg 800w" alt="the mats">
<img data-src="/img/lazy-ring.jpg" alt="ring">
<picture><source srcset="/img/pic-1600.webp 1600w, /img/pic-800.webp 800w"><img src="/img/pic-fallback.jpg"></picture>
<img src="/img/og-hero.jpg">
</body></html>
"""


def png(w: int, h: int) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (200, 40, 30)).save(buf, format="PNG")
    return buf.getvalue()


class ExtractCandidates(unittest.TestCase):
    def test_order_and_filtering(self):
        urls = [c["url"] for c in extract_candidates(HTML, BASE)]
        # og:image first, twitter second, then body images in document order
        self.assertEqual(urls[0], "https://example-gym.com/img/og-hero.jpg")
        self.assertEqual(urls[1], "https://cdn.example-gym.com/tw.jpg")
        # largest srcset candidate wins; smaller ones and the src fallback are not added
        self.assertIn("https://example-gym.com/img/mats-1200.jpg", urls)
        self.assertNotIn("https://example-gym.com/img/mats-400.jpg", urls)
        self.assertNotIn("https://example-gym.com/img/mats-small.jpg", urls)
        # <picture><source> largest wins over the fallback img
        self.assertIn("https://example-gym.com/img/pic-1600.webp", urls)
        self.assertNotIn("https://example-gym.com/img/pic-fallback.jpg", urls)
        # lazy attr picked up
        self.assertIn("https://example-gym.com/img/lazy-ring.jpg", urls)
        # logos, svg, data uris dropped
        self.assertFalse(any("logo" in u or u.endswith(".svg") or u.startswith("data:") for u in urls))
        # duplicates collapse
        self.assertEqual(len(urls), len(set(urls)))

    def test_keeps_alt(self):
        by_url = {c["url"]: c["alt"] for c in extract_candidates(HTML, BASE)}
        self.assertEqual(by_url["https://example-gym.com/img/mats-1200.jpg"], "the mats")
        self.assertEqual(by_url["https://example-gym.com/img/lazy-ring.jpg"], "ring")

    def test_same_origin_before_third_party(self):
        html = """
        <img src="https://cdn.sharebuttons.example/fb.png">
        <img src="/img/ring-1.jpg">
        <img src="https://cdn.sharebuttons.example/tw.png">
        <img src="/img/ring-2.jpg">
        """
        urls = [c["url"] for c in extract_candidates(html, BASE)]
        self.assertEqual(urls[:2], ["https://example-gym.com/img/ring-1.jpg", "https://example-gym.com/img/ring-2.jpg"])
        self.assertEqual(urls[2:], ["https://cdn.sharebuttons.example/fb.png", "https://cdn.sharebuttons.example/tw.png"])


class FindGalleryUrl(unittest.TestCase):
    def test_same_origin_only(self):
        self.assertEqual(find_gallery_url(HTML, BASE), "https://example-gym.com/gallery")
        self.assertIsNone(find_gallery_url("<a href='/about'>x</a>", BASE))


class Prepare(unittest.TestCase):
    def test_rejects_small_extreme_aspect_and_garbage(self):
        self.assertIsNone(prepare(png(400, 300)))
        self.assertIsNone(prepare(png(2000, 300)))  # > 3:1 banner
        self.assertIsNone(prepare(png(600, 1500)))  # taller than 1:2
        self.assertIsNone(prepare(b"not an image"))

    def test_resizes_and_encodes_webp(self):
        data, w, h = prepare(png(3200, 1800))
        self.assertEqual((w, h), (1600, 900))
        img = Image.open(io.BytesIO(data))
        self.assertEqual(img.format, "WEBP")
        self.assertEqual(img.size, (1600, 900))

    def test_keeps_small_enough_images_unscaled(self):
        _, w, h = prepare(png(800, 600))
        self.assertEqual((w, h), (800, 600))



class FilenameAlt(unittest.TestCase):
    def test_filename_like_alts_are_rejected(self):
        from scrapers.fetch_photos import FILENAME_ALT
        for bad in ["gym2 3.png", "IMG_4021", "hero-1", "add5.PNG", "DSC00012.jpeg"]:
            self.assertTrue(FILENAME_ALT.search(bad), bad)
        for good in ["the mats", "Coach Nok holding pads", "Fight team 2025"]:
            self.assertFalse(FILENAME_ALT.search(good), good)


if __name__ == "__main__":
    unittest.main()
