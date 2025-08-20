import { Button } from "./ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "./ui/dialog"
import { useEffect, useState } from "react"

export default function BrowserCheck() {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button size="xs" variant="link">
					Check system
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>System</DialogTitle>
					<DialogDescription>Checking your system.</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-2">
					<SecureContext />
					<DeviceMemory />
					<StorageEstimate />
					<MaxArraySizes />
				</div>
			</DialogContent>
		</Dialog>
	)
}

function SecureContext() {
	const [secure, setSecure] = useState(false)
	const [crossOriginIsolated, setCrossOriginIsolated] = useState(false)
	const [hardwareConcurrency, setHardwareConcurrency] = useState(0)

	useEffect(() => {
		setSecure(window.isSecureContext)
		setCrossOriginIsolated(window.crossOriginIsolated)
		setHardwareConcurrency(navigator.hardwareConcurrency)
	}, [])

	return (
		<div>
			<div className="font-bold">Secure context</div>
			<div>{secure ? "yes" : "no"}</div>
			<div className="font-bold">Cross origin isolated</div>
			<div>{crossOriginIsolated ? "yes" : "no"}</div>
			<div className="font-bold">Hardware concurrency</div>
			<div>{hardwareConcurrency}</div>
		</div>
	)
}

function DeviceMemory() {
	const [memory, setMemory] = useState("unknown")

	useEffect(() => {
		setMemory(
			"deviceMemory" in navigator ? `${navigator.deviceMemory}GB` : "unknown",
		)
	}, [])

	return (
		<div>
			<div className="font-bold">Device memory available</div>
			<div>{memory}</div>
		</div>
	)
}

function StorageEstimate() {
	const [storage, setStorage] = useState({
		quota: 0,
		usage: 0,
	})

	useEffect(() => {
		navigator.storage.estimate().then((estimate) => {
			setStorage({
				quota: estimate.quota ?? 0,
				usage: estimate.usage ?? 0,
			})
		})
	}, [])

	return (
		<div>
			<div className="font-bold">Storage</div>
			<div>Usage: {(storage.usage / 1024 / 1024).toFixed(2)} MB</div>
			<div>Quota: {(storage.quota / 1024 / 1024).toFixed(2)} MB</div>
			<div>
				Percentage: {((storage.usage / storage.quota) * 100).toFixed(2)}%
			</div>
		</div>
	)
}

const TypedArrays = [
	Float64Array,
	Float32Array,
	Uint32Array,
	Int32Array,
	Uint16Array,
	Int16Array,
	Uint8Array,
	Int8Array,
]
const START_SIZE = 100_000_000
const increment = 10_000_000

function MaxArraySizes() {
	const [maxArraySizes, setMaxArraySizes] = useState(
		Object.fromEntries(TypedArrays.map((array) => [array.name, 0])),
	)
	const [calculated, setCalculated] = useState(false)

	useEffect(() => {
		setTimeout(() => {
			const newSizes = Object.fromEntries(
				TypedArrays.map((array) => [array.name, 0]),
			)
			let maxSize = START_SIZE
			for (const array of TypedArrays) {
				while (true) {
					try {
						new array(maxSize)
					} catch (error) {
						newSizes[array.name] = (maxSize - increment) / 1_000_000
						break
					}
					maxSize += increment
				}
			}
			setMaxArraySizes(newSizes)
			setCalculated(true)
		}, 0)
	}, [])

	return (
		<div>
			<div className="font-bold">Max array sizes</div>
			{calculated ? (
				<>
					<div>Int8Array: {maxArraySizes.Int8Array.toLocaleString()}M</div>
					<div>Uint8Array: {maxArraySizes.Uint8Array.toLocaleString()}M</div>
					<div>Int16Array: {maxArraySizes.Int16Array.toLocaleString()}M</div>
					<div>Uint16Array: {maxArraySizes.Uint16Array.toLocaleString()}M</div>
					<div>Int32Array: {maxArraySizes.Int32Array.toLocaleString()}M</div>
					<div>Uint32Array: {maxArraySizes.Uint32Array.toLocaleString()}M</div>
					<div>
						Float32Array: {maxArraySizes.Float32Array.toLocaleString()}M
					</div>
					<div>
						Float64Array: {maxArraySizes.Float64Array.toLocaleString()}M
					</div>
				</>
			) : (
				<div>Calculating...</div>
			)}
		</div>
	)
}
