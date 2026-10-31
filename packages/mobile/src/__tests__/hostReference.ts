export function attachHostReference<Node extends { readonly props: Record<string, unknown> }>(node: Node): Node {
  const reference = node.props.ref as ((instance: Node) => void) | { current: unknown } | null | undefined;
  if (typeof reference === "function") {
    reference(node);
  } else if (reference && typeof reference === "object") {
    reference.current = node;
  }
  return node;
}
