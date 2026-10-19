/**
 * @tasks/review public surface.
 *
 * The web (and any non-OpenTUI consumer) needs exactly one thing from this
 * package: the task-store-backed ReviewCommentStore seam, plus the seam types
 * it exchanges. Everything else (core diffing, OpenTUI UI, vcs watch) stays
 * internal until a consumer asks for it.
 */

export { taskStoreCommentStore } from "./app/taskStoreCommentStore.js";

export type {
  AppendReplyInput,
  CreateThreadInput,
  ReviewCommentSide,
  ReviewCommentStore,
  ReviewThread,
  ReviewThreadComment,
  ReviewThreadList,
  ReviewThreadPlacement,
  ReviewThreadRecord,
  ReviewThreadRegistry,
  SerializedReviewThreadRegistry,
  SetResolvedInput,
} from "./core/review/commentStore.js";
export {
  ReviewCommentStoreError,
  reviewThreadRegistryKey,
} from "./core/review/commentStore.js";
