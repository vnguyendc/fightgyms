import sample from "../src/data/sample.json";
import type { GymCard, Place } from "../src/lib/types";
// Explicit test fixtures only. These are never used as live directory records.
export const place = sample.places[0] as Place;
export const gym: GymCard = { ...sample.gyms[0], id: "test-gym", slug: "test-gym", name: "Test gym", is_sample: false, styles: ["muay_thai"], tags: [], active_fighters: 0 } as GymCard;
