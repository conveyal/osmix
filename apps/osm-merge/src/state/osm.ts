import { atom } from "jotai"
import { atomFamily } from "jotai/utils"
import type { Osm } from "osm.ts"

export const osmAtomFamily = atomFamily((id: string) => atom<Osm | null>(null))
