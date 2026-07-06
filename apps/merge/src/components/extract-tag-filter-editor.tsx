import { Plus, Trash2 } from "lucide-react"
import type { ExtractTagFilterRule, ExtractTagFilterRules } from "osmix"
import { CONVEYAL_EXTRACT_TAG_FILTERS, normalizeTagFilterRules } from "osmix"

import { Button } from "./ui/button"
import { Input } from "./ui/input"

export type TagFilterEditorRow = {
	id: string
	key: string
	value: string
}

type TagFilterEditorState = {
	nodes: TagFilterEditorRow[]
	ways: TagFilterEditorRow[]
	relations: TagFilterEditorRow[]
}

export type { TagFilterEditorState }

type EntitySection = keyof TagFilterEditorState

function newRow(partial?: Partial<Pick<TagFilterEditorRow, "key" | "value">>) {
	return {
		id: crypto.randomUUID(),
		key: partial?.key ?? "",
		value: partial?.value ?? "",
	}
}

function rulesToRows(rules: ExtractTagFilterRule[]): TagFilterEditorRow[] {
	return rules.map((rule) => newRow({ key: rule.key, value: rule.value ?? "" }))
}

export function editorStateFromRules(
	rules: ExtractTagFilterRules,
): TagFilterEditorState {
	return {
		nodes: rulesToRows(rules.nodes),
		ways: rulesToRows(rules.ways),
		relations: rulesToRows(rules.relations),
	}
}

export function rulesFromEditorState(
	state: TagFilterEditorState,
): ExtractTagFilterRules {
	const toRules = (rows: TagFilterEditorRow[]): ExtractTagFilterRule[] =>
		rows.map((row) => ({
			key: row.key,
			...(row.value.trim() ? { value: row.value.trim() } : {}),
		}))

	return normalizeTagFilterRules({
		nodes: toRules(state.nodes),
		ways: toRules(state.ways),
		relations: toRules(state.relations),
	})
}

export function conveyalTagFilterEditorState(): TagFilterEditorState {
	return editorStateFromRules(CONVEYAL_EXTRACT_TAG_FILTERS)
}

function TagFilterSection({
	title,
	rows,
	onChange,
}: {
	title: string
	rows: TagFilterEditorRow[]
	onChange: (rows: TagFilterEditorRow[]) => void
}) {
	const updateRow = (id: string, patch: Partial<TagFilterEditorRow>) => {
		onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)))
	}

	const removeRow = (id: string) => {
		onChange(rows.filter((row) => row.id !== id))
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-baseline justify-between gap-2">
				<h3 className="font-semibold">{title}</h3>
				<span className="text-muted-foreground text-right">
					One rule: required. Multiple: match any.
				</span>
			</div>
			{rows.length === 0 ? (
				<p className="text-center">No rules (no tag filter).</p>
			) : null}
			<ul className="flex flex-col gap-1">
				{rows.map((row) => (
					<li key={row.id} className="flex items-center gap-1">
						<Input
							value={row.key}
							onChange={(e) => updateRow(row.id, { key: e.target.value })}
							placeholder="key"
							className="h-8 text-xs font-mono flex-1 min-w-0"
							aria-label={`${title} tag key`}
						/>
						<Input
							value={row.value}
							onChange={(e) => updateRow(row.id, { value: e.target.value })}
							placeholder="any value"
							className="h-8 text-xs font-mono flex-1 min-w-0"
							aria-label={`${title} tag value`}
						/>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={() => removeRow(row.id)}
							aria-label={`Remove ${title} rule`}
						>
							<Trash2 className="size-3.5" />
						</Button>
					</li>
				))}
			</ul>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="w-full text-xs"
				onClick={() => onChange([...rows, newRow()])}
			>
				<Plus className="size-3.5" />
				Add rule
			</Button>
		</div>
	)
}

export default function ExtractTagFilterEditor({
	state,
	onChange,
}: {
	state: TagFilterEditorState
	onChange: (state: TagFilterEditorState) => void
}) {
	const setSection = (section: EntitySection, rows: TagFilterEditorRow[]) => {
		onChange({ ...state, [section]: rows })
	}

	return (
		<div className="flex flex-col gap-4">
			<Button
				type="button"
				variant="outline"
				size="sm"
				onClick={() => onChange(conveyalTagFilterEditorState())}
			>
				Use Conveyal tag filters
			</Button>
			<TagFilterSection
				title="Nodes"
				rows={state.nodes}
				onChange={(rows) => setSection("nodes", rows)}
			/>
			<TagFilterSection
				title="Ways"
				rows={state.ways}
				onChange={(rows) => setSection("ways", rows)}
			/>
			<TagFilterSection
				title="Relations"
				rows={state.relations}
				onChange={(rows) => setSection("relations", rows)}
			/>
		</div>
	)
}
