export function shouldPreserveComposerOnBlur(input: {
  pointerDownInside: boolean;
  relatedTargetInside: boolean;
  activeElementInside: boolean;
}) {
  return input.pointerDownInside || input.relatedTargetInside || input.activeElementInside;
}
