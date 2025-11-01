import type {
	CircleLayerSpecification,
	LineLayerSpecification,
} from "maplibre-gl"

export const waysOutlinePaint: LineLayerSpecification["paint"] = {
	"line-color": "#99a1af",
	"line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 14, 3, 18, 15],
	"line-opacity": [
		"case",
		["boolean", ["feature-state", "hover"], false],
		1,
		0.5,
	],
}

export const waysPaint: LineLayerSpecification["paint"] = {
	"line-color": [
		"case",
		["boolean", ["feature-state", "hover"], false],
		"#ef4444",
		"#3b82f6",
	],
	"line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 14, 2, 18, 10],
	"line-opacity": [
		"case",
		["boolean", ["feature-state", "hover"], false],
		1,
		0.5,
	],
}

export const nodesPaint: CircleLayerSpecification["paint"] = {
	"circle-color": "white",
	"circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 14, 3, 18, 6],
	"circle-stroke-color": ["rgba", 0, 0, 0, 0.5],
	"circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 18, 2],
	"circle-opacity": [
		"case",
		["boolean", ["feature-state", "hover"], false],
		1,
		0.5,
	],
}
