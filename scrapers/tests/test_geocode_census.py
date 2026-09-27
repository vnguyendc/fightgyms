"""Offline: census geocoder response parsing and query building. No network or database."""
import unittest

from scrapers import geocode_census as geo


def response(*matches):
    return {"result": {"addressMatches": [
        {"matchedAddress": addr, "coordinates": {"x": lng, "y": lat}} for addr, lat, lng in matches]}}


class Parse(unittest.TestCase):
    def test_first_match_in_the_gyms_state_wins(self):
        r = response(("213 W 35TH ST, NEW YORK, NY, 10001", 40.75188, -73.9905))
        self.assertEqual(geo.parse_match(r, "NY"), (40.75188, -73.9905, "213 W 35TH ST, NEW YORK, NY, 10001"))

    def test_matches_in_another_state_or_none_are_rejected(self):
        self.assertIsNone(geo.parse_match(response(("1 MAIN ST, PATERSON, NJ, 07501", 40.9, -74.1)), "NY"))
        self.assertIsNone(geo.parse_match(response(), "NY"))
        self.assertIsNone(geo.parse_match({"errors": ["bad"]}, "NY"))
        both = response(("1 MAIN ST, PATERSON, NJ, 07501", 40.9, -74.1), ("1 MAIN ST, NEW YORK, NY, 10001", 40.7, -73.9))
        self.assertEqual(geo.parse_match(both, "NY")[:2], (40.7, -73.9))

    def test_coordinates_outside_the_us_box_are_rejected(self):
        self.assertIsNone(geo.parse_match(response(("1 MAIN ST, NEW YORK, NY, 10001", 0.0, 0.0)), "NY"))


class Query(unittest.TestCase):
    def test_full_addresses_are_sent_as_printed_and_street_only_gets_city_and_state(self):
        self.assertEqual(geo.query("213 W 35th Street, New York, NY 10001", "New York", "NY"),
                         "213 W 35th Street, New York, NY 10001")
        self.assertEqual(geo.query("67 Ingraham St", "Brooklyn", "NY"), "67 Ingraham St, Brooklyn, NY")
        self.assertEqual(geo.query("4231 Duke St # B, Alexandria, VA 22304, USA", "Alexandria", "VA"),
                         "4231 Duke St # B, Alexandria, VA 22304, USA")
        # the city inside a street name is not the city of the address
        self.assertEqual(geo.query("707 Jackson Mills Rd", "Jackson", "NJ"), "707 Jackson Mills Rd, Jackson, NJ")

    def test_retry_form_drops_suites_and_spells_the_state_as_its_code(self):
        cases = [
            ("113 Muskoka Court, Suite #111, Winchester, VA 22602", "Winchester", "VA", "113 Muskoka Court, Winchester, VA 22602"),
            ("95 Dell Glen Avenue, Unit B Lodi, NJ 07644", "Lodi", "NJ", "95 Dell Glen Avenue, Lodi, NJ 07644"),
            ("1244 Ritchie Hwy, Suite 3 Arnold, MD 21012", "Arnold", "MD", "1244 Ritchie Hwy, Arnold, MD 21012"),
            ("12712 Rock Creek Mill Road, Rockville, Maryland", "Rockville", "MD", "12712 Rock Creek Mill Road, Rockville, MD"),
            ("2793 Brunswick Pike Lawrenceville, NJ, New Jersey 08648", "Lawrenceville", "NJ",
             "2793 Brunswick Pike, Lawrenceville, NJ 08648"),
            ("1360 N American St Philadelphia, PA 19122", "Philadelphia", "PA", "1360 N American St, Philadelphia, PA 19122"),
            ("72-08 Austin Street 2nd Floor, Forest Hills, NY 11375", "Forest Hills", "NY",
             "72-08 Austin Street, Forest Hills, NY 11375"),
        ]
        for address, city, state, want in cases:
            with self.subTest(address=address):
                self.assertEqual(geo.retry_form(geo.query(address, city, state), city, state), want)


if __name__ == "__main__":
    unittest.main()
