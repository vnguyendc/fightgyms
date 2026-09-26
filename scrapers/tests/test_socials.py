"""Offline tests for social profile link handling: url parsing, html harvesting, and picking one
profile per platform. No network, no model, no database."""
import unittest

from scrapers.common.socials import harvest, parse, pick, rank

BASE = "https://www.siamstrike.com/"


class Parse(unittest.TestCase):
    def test_instagram_profile_is_canonicalised(self):
        self.assertEqual(parse("https://www.instagram.com/siamstrike/"),
                         {"platform": "instagram", "url": "https://www.instagram.com/siamstrike", "handle": "siamstrike"})
        self.assertEqual(parse("http://instagram.com/SiamStrike?hl=en")["url"], "https://www.instagram.com/SiamStrike")
        self.assertEqual(parse("//instagram.com/siam.strike_mt/")["handle"], "siam.strike_mt")

    def test_instagram_posts_and_site_pages_are_not_profiles(self):
        for u in ["https://www.instagram.com/p/Cx1aBcD/", "https://www.instagram.com/reel/abc/",
                  "https://www.instagram.com/explore/tags/muaythai/", "https://www.instagram.com/",
                  "https://www.instagram.com/accounts/login/", "https://www.instagram.com/stories/x/1/"]:
            self.assertIsNone(parse(u), u)

    def test_facebook_pages_profiles_and_legacy_paths(self):
        self.assertEqual(parse("https://www.facebook.com/SiamStrikeMT/"),
                         {"platform": "facebook", "url": "https://www.facebook.com/SiamStrikeMT", "handle": "SiamStrikeMT"})
        self.assertEqual(parse("https://facebook.com/SiamStrikeMT/photos/?ref=page_internal")["url"], "https://www.facebook.com/SiamStrikeMT")
        self.assertEqual(parse("https://m.facebook.com/profile.php?id=100012345678901&ref=x"),
                         {"platform": "facebook", "url": "https://www.facebook.com/profile.php?id=100012345678901", "handle": None})
        self.assertEqual(parse("https://www.facebook.com/pages/Siam-Strike/123456789")["url"], "https://www.facebook.com/pages/Siam-Strike/123456789")
        self.assertEqual(parse("https://www.facebook.com/pg/SiamStrikeMT/about/")["handle"], "SiamStrikeMT")
        self.assertEqual(parse("https://fb.com/SiamStrikeMT")["platform"], "facebook")

    def test_facebook_share_buttons_groups_and_events_are_dropped(self):
        for u in ["https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fexample-gym.com",
                  "https://www.facebook.com/sharer.php?u=x", "https://www.facebook.com/share.php?u=x",
                  "https://www.facebook.com/dialog/share?app_id=1", "https://www.facebook.com/plugins/like.php?href=x",
                  "https://www.facebook.com/groups/123456", "https://www.facebook.com/events/123456",
                  "https://www.facebook.com/photo.php?fbid=1", "https://www.facebook.com/login.php",
                  "https://www.facebook.com/", "https://www.facebook.com/hashtag/muaythai",
                  "https://www.facebook.com/watch/?v=1", "https://www.facebook.com/profile.php"]:
            self.assertIsNone(parse(u), u)

    def test_tiktok_requires_an_at_handle(self):
        self.assertEqual(parse("https://www.tiktok.com/@siam.strike"),
                         {"platform": "tiktok", "url": "https://www.tiktok.com/@siam.strike", "handle": "siam.strike"})
        self.assertEqual(parse("https://tiktok.com/@siamstrike/video/7234567890?lang=en")["url"], "https://www.tiktok.com/@siamstrike")
        for u in ["https://www.tiktok.com/", "https://www.tiktok.com/embed/v2/1", "https://www.tiktok.com/t/ZTabc/",
                  "https://www.tiktok.com/music/x-1", "https://www.tiktok.com/tag/muaythai"]:
            self.assertIsNone(parse(u), u)

    def test_youtube_channels_but_not_videos(self):
        self.assertEqual(parse("https://www.youtube.com/@SiamStrike"),
                         {"platform": "youtube", "url": "https://www.youtube.com/@SiamStrike", "handle": "SiamStrike"})
        self.assertEqual(parse("https://youtube.com/channel/UCabcdefghijklmnopqrstuv?sub_confirmation=1"),
                         {"platform": "youtube", "url": "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv", "handle": None})
        self.assertEqual(parse("https://www.youtube.com/c/SiamStrike/videos")["url"], "https://www.youtube.com/c/SiamStrike")
        self.assertEqual(parse("https://www.youtube.com/user/siamstrike1")["handle"], "siamstrike1")
        self.assertEqual(parse("https://m.youtube.com/@SiamStrike/featured")["url"], "https://www.youtube.com/@SiamStrike")
        for u in ["https://www.youtube.com/watch?v=abc123", "https://youtu.be/abc123", "https://www.youtube.com/embed/abc123",
                  "https://www.youtube.com/shorts/abc123", "https://www.youtube.com/playlist?list=PL1", "https://www.youtube.com/",
                  "https://www.youtube.com/results?search_query=x", "https://www.youtube.com/channel/"]:
            self.assertIsNone(parse(u), u)

    def test_x_and_twitter_collapse_to_x(self):
        self.assertEqual(parse("https://twitter.com/siamstrike"),
                         {"platform": "x", "url": "https://x.com/siamstrike", "handle": "siamstrike"})
        self.assertEqual(parse("https://x.com/SiamStrike/status/123")["url"], "https://x.com/SiamStrike")
        self.assertEqual(parse("https://mobile.twitter.com/siamstrike?lang=en")["handle"], "siamstrike")
        for u in ["https://twitter.com/intent/tweet?text=hi", "https://twitter.com/share?url=x", "https://twitter.com/",
                  "https://twitter.com/home", "https://twitter.com/i/flow/login", "https://x.com/hashtag/muaythai",
                  "https://twitter.com/search?q=x", "https://twitter.com/this_handle_is_way_too_long"]:
            self.assertIsNone(parse(u), u)

    def test_platform_and_vendor_accounts_are_not_a_gym(self):
        for u in ["https://www.instagram.com/wix/", "https://www.facebook.com/squarespace", "https://www.instagram.com/mindbody.online",
                  "https://twitter.com/twitter", "https://www.youtube.com/@YouTube", "https://www.instagram.com/elfsight",
                  "https://www.facebook.com/facebook", "https://www.instagram.com/instagram/", "https://www.tiktok.com/@tiktok"]:
            self.assertIsNone(parse(u), u)

    def test_everything_else_is_none(self):
        for u in ["https://example-gym.com/instagram", "https://www.linkedin.com/company/siamstrike", "mailto:hi@example-gym.com",
                  "tel:+17035550101", "not a url", "", "https://instagram.com.evil.example/siamstrike", "javascript:void(0)"]:
            self.assertIsNone(parse(u), u)


HOME = """<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"SportsActivityLocation","name":"Siam Strike",
 "sameAs":["https://www.instagram.com/siamstrike/","https://www.facebook.com/SiamStrikeMT"]}</script>
</head><body>
<a href="https://www.instagram.com/siamstrike/">ig</a>
<a href="//www.facebook.com/SiamStrikeMT/">fb</a>
<a href="https://www.facebook.com/sharer/sharer.php?u=https://www.siamstrike.com">share</a>
<a href="https://www.instagram.com/p/Cx1aBcD/">post</a>
<a href="/contact">contact</a>
<a href="https://www.tiktok.com/@siamstrike">tt</a>
<a href="https://www.instagram.com/kru_somchai/">coach</a>
</body></html>"""


class Harvest(unittest.TestCase):
    def test_anchors_then_sameas_with_weights(self):
        found = harvest(HOME, BASE)
        seen = [(f["platform"], f["url"], f["weight"]) for f in found]
        self.assertEqual(seen, [
            ("instagram", "https://www.instagram.com/siamstrike", 1),
            ("facebook", "https://www.facebook.com/SiamStrikeMT", 1),   # protocol-relative href resolved
            ("tiktok", "https://www.tiktok.com/@siamstrike", 1),
            ("instagram", "https://www.instagram.com/kru_somchai", 1),
            ("instagram", "https://www.instagram.com/siamstrike", 2),  # a site's own sameAs counts double
            ("facebook", "https://www.facebook.com/SiamStrikeMT", 2),
        ])
        self.assertTrue(all(f["source_url"] == BASE for f in found))
        self.assertEqual(found[0]["handle"], "siamstrike")

    def test_sameas_string_inside_a_graph(self):
        html = '<script type="application/ld+json">{"@graph":[{"@type":"Organization","sameAs":"https://twitter.com/siamstrike"}]}</script>'
        self.assertEqual([(f["platform"], f["url"], f["weight"]) for f in harvest(html, BASE)], [("x", "https://x.com/siamstrike", 2)])

    def test_broken_jsonld_and_other_scripts_are_ignored(self):
        html = ('<script type="application/ld+json">{not json</script><script>var sameAs="https://www.instagram.com/wrong";</script>'
                '<a href="https://www.instagram.com/siamstrike">x</a>')
        self.assertEqual([f["url"] for f in harvest(html, BASE)], ["https://www.instagram.com/siamstrike"])


def _hit(platform, handle, page=BASE, weight=1):
    url = {"instagram": f"https://www.instagram.com/{handle}", "facebook": f"https://www.facebook.com/{handle}"}[platform]
    return {"platform": platform, "url": url, "handle": handle, "source_url": page, "weight": weight}


class RankAndPick(unittest.TestCase):
    def test_domain_match_beats_frequency(self):
        found = [_hit("instagram", "kru_somchai"), _hit("instagram", "kru_somchai", BASE + "team"), _hit("instagram", "kru_somchai"),
                 _hit("instagram", "siamstrike"), _hit("facebook", "usmta"), _hit("facebook", "SiamStrikeMT"), _hit("facebook", "usmta")]
        ranked = rank(found, "https://www.siamstrike.com/")
        self.assertEqual([(r["platform"], r["handle"], r["count"], r["similar"]) for r in ranked], [
            ("instagram", "siamstrike", 1, True), ("instagram", "kru_somchai", 3, False),
            ("facebook", "SiamStrikeMT", 1, True), ("facebook", "usmta", 2, False),
        ])
        self.assertEqual(ranked[1]["source_url"], BASE)  # first page it was seen on

    def test_without_a_domain_match_frequency_then_first_seen_decide(self):
        found = [_hit("facebook", "usmta"), _hit("facebook", "SiamStrikeMT"), _hit("facebook", "usmta"), _hit("facebook", "SiamStrikeMT"),
                 _hit("instagram", "kru_somchai"), _hit("instagram", "siamstrike", weight=2)]
        ranked = rank(found, "https://www.example-gym.com/")
        self.assertEqual([(r["platform"], r["handle"], r["count"]) for r in ranked],
                         [("instagram", "siamstrike", 2), ("instagram", "kru_somchai", 1), ("facebook", "usmta", 2), ("facebook", "SiamStrikeMT", 2)])

    def test_pick_takes_the_best_per_platform_in_platform_order(self):
        found = [_hit("facebook", "SiamStrikeMT"), _hit("instagram", "kru_somchai"), _hit("instagram", "siamstrike", weight=2)]
        picked = pick(rank(found, "https://www.example-gym.com/"))
        self.assertEqual([(s["platform"], s["url"]) for s in picked],
                         [("instagram", "https://www.instagram.com/siamstrike"), ("facebook", "https://www.facebook.com/SiamStrikeMT")])
        self.assertEqual(pick([]), [])

    def test_gym_name_counts_like_the_domain_for_similarity(self):
        # a sub-brand page on the parent company's domain links its own account more often than the parent's
        found = [_hit("instagram", "onelifefit"), _hit("instagram", "strikestudio_va"), _hit("instagram", "onelifefit"),
                 _hit("instagram", "strikestudio_va"), _hit("instagram", "strikestudio_va")]
        ranked = rank(found, "https://www.onelifefitness.com/boxing", name="Strike Studio Alexandria")
        self.assertEqual([(r["handle"], r["count"], r["similar"]) for r in ranked], [("strikestudio_va", 3, True), ("onelifefit", 2, True)])
        self.assertFalse(rank([_hit("instagram", "kru_somchai")], "https://www.siamstrike.com/", name="Siam Strike Muay Thai")[0]["similar"])

    def test_case_variants_of_a_handle_are_one_profile(self):
        ranked = rank([_hit("instagram", "SiamStrike"), _hit("instagram", "siamstrike"), _hit("instagram", "other")], "https://www.example-gym.com/")
        self.assertEqual([(r["url"], r["count"]) for r in ranked], [("https://www.instagram.com/SiamStrike", 2), ("https://www.instagram.com/other", 1)])

    def test_similarity_ignores_case_punctuation_and_short_fragments(self):
        similar = lambda handle, site: rank([_hit("instagram", handle)], site)[0]["similar"]  # noqa: E731
        self.assertTrue(similar("Siam.Strike_MT", "https://siamstrike.com"))
        self.assertTrue(similar("siamstrike", "https://www.siam-strike.co.uk/"))
        self.assertFalse(similar("mt", "https://mtgym.com"))          # too short to mean anything
        self.assertFalse(similar("muaythai_dc", "https://www.arlingtonmuaythai.com"))


if __name__ == "__main__":
    unittest.main()
