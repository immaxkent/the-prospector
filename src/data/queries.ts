import { queryOptions } from "@tanstack/react-query";
import { fetchDataset } from "@/api/dataset";

/** Everything the screens read in live mode. Mutations invalidate this key. */
export const datasetQuery = queryOptions({
  queryKey: ["dataset"] as const,
  queryFn: () => fetchDataset(),
});
