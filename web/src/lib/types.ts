export type Style =
  | "muay_thai"
  | "kickboxing"
  | "dutch_kickboxing"
  | "boxing"
  | "mma"
  | "bjj"
  | "wrestling"
  | "judo";

export type Tag =
  | "beginner_friendly"
  | "fighter_gym"
  | "kids"
  | "womens"
  | "open_mat"
  | "thai_trainers";

export const STYLE_LABEL: Record<Style, string> = {
  muay_thai: "Muay Thai",
  kickboxing: "Kickboxing",
  dutch_kickboxing: "Dutch Kickboxing",
  boxing: "Boxing",
  mma: "MMA",
  bjj: "BJJ",
  wrestling: "Wrestling",
  judo: "Judo",
};

export const STYLE_SLUG: Record<Style, string> = {
  muay_thai: "muay-thai",
  kickboxing: "kickboxing",
  dutch_kickboxing: "dutch-kickboxing",
  boxing: "boxing",
  mma: "mma",
  bjj: "bjj",
  wrestling: "wrestling",
  judo: "judo",
};

/** Disciplines with public pages. Others are stored but not surfaced yet (see discipline rollout). */
export const LIVE_STYLES: Style[] = ["muay_thai", "kickboxing"];

export const TAG_LABEL: Record<Tag, string> = {
  beginner_friendly: "Beginner friendly",
  fighter_gym: "Fight team",
  kids: "Kids classes",
  womens: "Women's classes",
  open_mat: "Open mat",
  thai_trainers: "Thai trainers",
};

export interface Place {
  id: string;
  state: string;
  city: string;
  slug: string;
  lat: number | null;
  lng: number | null;
  population: number | null;
}

export interface Photo {
  /** path inside the gym-photos bucket, or a site-relative path for sample data */
  storage_path: string;
  width: number | null;
  height: number | null;
  alt: string | null;
  credit: string | null; // website | gym_claim
}

export interface GymCard {
  id: string;
  slug: string;
  name: string;
  styles: Style[];
  tags: Tag[];
  address: string | null;
  lat: number | null;
  lng: number | null;
  website: string | null;
  instagram: string | null;
  google_rating: number | null;
  google_reviews: number | null;
  claimed: boolean;
  is_sample: boolean;
  place_slug: string | null;
  city: string | null;
  state: string | null;
  drop_in_cents: number | null;
  monthly_cents: number | null;
  /** latest verified trial / intro price; null when the gym has none listed */
  trial_cents: number | null;
  /** rows in `classes`; 0 means no schedule listed */
  class_count: number;
  active_fighters: number;
  pro_fighters: number;
  photo_path: string | null;
}

export interface Price {
  kind: "drop_in" | "monthly" | "fighter" | "trial" | "private" | "class_pack";
  amount_cents: number | null;
  contract_months: number | null;
  free_trial: boolean | null;
  notes: string | null;
  verified_at: string | null;
  verified_by: string | null;
}

export interface ClassRow {
  dow: number;
  start_time: string;
  end_time: string | null;
  name: string | null;
  level: string | null;
  style: string | null;
}

export interface Coach {
  slug: string;
  name: string;
  is_thai: boolean | null;
  lineage: string | null;
  pro_record: string | null;
  instagram?: string | null;
}

export interface Fighter {
  slug: string;
  name: string;
  discipline: string | null;
  level: string | null;
  weight_class: string | null;
  record_w: number;
  record_l: number;
  record_d: number;
  last_bout: string | null;
}

export interface GymDetail extends GymCard {
  description: string | null;
  phone: string | null;
  affiliation: string | null;
  founded_year: number | null;
  prices: Price[];
  classes: ClassRow[];
  coaches: Coach[];
  fighters: Fighter[];
  photos: Photo[];
}

export interface Event {
  slug: string;
  name: string;
  promotion: string | null;
  sanctioning_body: string | null;
  date: string | null;
  venue: string | null;
  url: string | null;
  accepting_amateurs: boolean | null;
}
