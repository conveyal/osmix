import { atom } from "jotai";
import type { GeoBbox2D } from "osmix";

import { DEFAULT_EXTRACT_BBOX } from "../lib/extract-bbox";

export const extractBboxAtom = atom<GeoBbox2D>(DEFAULT_EXTRACT_BBOX);
