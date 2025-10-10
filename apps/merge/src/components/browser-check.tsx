import { releaseProxy } from "comlink"
import { useEffect, useState, useTransition } from "react"
import { createBrowserCheckWorker } from "@/workers/browser-check.worker"
import { Button } from "./ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "./ui/dialog"
import { Spinner } from "./ui/spinner"

export default function BrowserCheck() {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button size="sm" variant="link">
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
			"deviceMemory" in navigator ? `${navigator.deviceMemory}GiB` : "unknown",
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
const START_SIZE_BYTES = 2 ** 24

function MaxArraySizes() {
	const [maxByteSize, setMaxByteSize] = useState(START_SIZE_BYTES)
	const [calculated, setCalculated] = useState(false)
	const [, startTransition] = useTransition()

	useEffect(() => {
		startTransition(async () => {
			const browserCheckWorker = createBrowserCheckWorker()
			setMaxByteSize(await browserCheckWorker.getMaxArraySize())
			setCalculated(true)
			browserCheckWorker[releaseProxy]()
		})
	}, [])

	return (
		<div>
			<div className="font-bold">Max array sizes</div>
			{calculated ? (
				TypedArrays.map((a) => (
					<div key={a.name}>
						{a.name}: {(maxByteSize / a.BYTES_PER_ELEMENT).toLocaleString()}
					</div>
				))
			) : (
				<Spinner />
			)}
		</div>
	)
}
