import { flattenValue } from "../lib/format.ts";
import { TableCell, TableRow } from "./ui/table.tsx";

export default function ObjectToTableRows({ object }: { object: null | Record<string, unknown> }) {
  if (!object) return null;
  return (
    <>
      {Object.entries(object)
        .filter(([_key, value]) => {
          return typeof value !== "undefined";
        })
        .map(([key, value]) => {
          const valueString =
            key.includes("timestamp") && typeof value === "number"
              ? new Date(value).toLocaleString()
              : flattenValue(value);
          return (
            <TableRow key={key}>
              <TableCell>{key}</TableCell>
              <TableCell>{valueString}</TableCell>
            </TableRow>
          );
        })}
    </>
  );
}
