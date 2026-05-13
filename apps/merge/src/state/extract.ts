import type { GeoBbox2D } from "@osmix/shared/types"
import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { DEFAULT_EXTRACT_BBOX } from "../lib/extract-bbox"

export const activeTabAtom = atomWithStorage<string>(
	"@osmix:merge:activeTab",
	"Inspect",
)

export const extractBboxAtom = atom<GeoBbox2D>(DEFAULT_EXTRACT_BBOX)
