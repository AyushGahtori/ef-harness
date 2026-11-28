import {
  Background,
  type Edge,
  MiniMap,
  type Node,
  ReactFlow,
  type ReactFlowProps,
} from "@xyflow/react";
import { createElement, memo, type ReactNode } from "react";
import { MemoizedCanvasNode } from "./canvas-node-component.js";
import type { CanvasGraphSnapshot, GraphViewNode, NodeBasis, TaskRuntimeBadge } from "./types.js";
import { CANVAS_REACT_FLOW_DEFAULTS } from "./react-flow-config.js";

export { CANVAS_REACT_FLOW_DEFAULTS };

export function toFlowNodes(snapshot: CanvasGraphSnapshot): Node[] {
  const visible = cullNodesToViewport(snapshot.nodes, snapshot.viewport, 1200, 800);
  return visible.map((node) => ({
    id: node.id,
    type: "canvasNode",
    position: { x: node.x, y: node.y },
    data: {
      label: node.label,
      kind: node.kind,
      basis: node.basis,
      dimmed: node.dimmed,
      highlighted: node.highlighted,
      conflictBubble: node.conflictBubble,
      skeletonLocked: node.skeletonLocked,
      taskBadge: node.taskBadge,
      agentId: node.agentId,
      aggregateBadge: node.aggregateBadge,
    },
    draggable: true,
    selectable: true,
  }));
}

export function cullNodesToViewport(
  nodes: readonly GraphViewNode[],
  viewport: CanvasGraphSnapshot["viewport"],
  width: number,
  height: number,
): GraphViewNode[] {
  return nodes.filter((node) => {
    const screenX = node.x * viewport.zoom + viewport.x;
    const screenY = node.y * viewport.zoom + viewport.y;
    const boxW = 180 * viewport.zoom;
    const boxH = 56 * viewport.zoom;
    return screenX + boxW >= 0 && screenY + boxH >= 0 && screenX <= width && screenY <= height;
  });
}

interface FlowNodeData {
  label: string;
  kind: GraphViewNode["kind"];
  basis: NodeBasis | null;
  dimmed: boolean;
  highlighted: boolean;
  conflictBubble: boolean;
  skeletonLocked: boolean;
  taskBadge: TaskRuntimeBadge | null;
  agentId: string | null;
  aggregateBadge: string | null;
}

const FlowCanvasNode = memo(function FlowCanvasNode(props: { id: string; data: FlowNodeData }): ReactNode {
  const data = props.data;
  const node: GraphViewNode = {
    id: props.id,
    label: data.label,
    kind: data.kind,
    basis: data.basis,
    dimmed: data.dimmed,
    highlighted: data.highlighted,
    conflictBubble: data.conflictBubble,
    aggregateBadge: data.aggregateBadge,
    taskBadge: data.taskBadge,
    agentId: data.agentId,
    skeletonLocked: data.skeletonLocked,
    x: 0,
    y: 0,
  };
  return createElement(MemoizedCanvasNode, { node, theme: "light" });
});

export const CANVAS_NODE_TYPES = { canvasNode: FlowCanvasNode };

export function toFlowEdges(snapshot: CanvasGraphSnapshot): Edge[] {
  return snapshot.edges.map((edge) => {
    if (edge.conflict) {
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        animated: true,
        style: { stroke: "#b42318", strokeWidth: 2 },
      };
    }
    if (edge.dimmed) {
      return { id: edge.id, source: edge.source, target: edge.target, animated: false, style: { opacity: 0.2 } };
    }
    return { id: edge.id, source: edge.source, target: edge.target, animated: false };
  });
}

export interface ReactFlowCanvasViewProps {
  readonly snapshot: CanvasGraphSnapshot;
  readonly children?: ReactNode;
  readonly onNodesChange?: ReactFlowProps["onNodesChange"];
  readonly onMoveEnd?: ReactFlowProps["onMoveEnd"];
  readonly onNodeDragStop?: (nodeId: string, x: number, y: number) => void;
}

function ReactFlowCanvasViewBase(props: ReactFlowCanvasViewProps): ReactNode {
  const flowProps: ReactFlowProps = {
    ...CANVAS_REACT_FLOW_DEFAULTS,
    nodes: toFlowNodes(props.snapshot),
    edges: toFlowEdges(props.snapshot),
    nodeTypes: CANVAS_NODE_TYPES,
  };
  if (props.onNodesChange) flowProps.onNodesChange = props.onNodesChange;
  if (props.onMoveEnd) flowProps.onMoveEnd = props.onMoveEnd;
  if (props.onNodeDragStop) {
    flowProps.onNodeDragStop = (_event, node) => {
      props.onNodeDragStop?.(node.id, node.position.x, node.position.y);
    };
  }
  const minimap = props.snapshot.minimapCollapsed
    ? null
    : createElement(MiniMap, {
        pannable: true,
        zoomable: true,
        position: "bottom-right",
        ariaLabel: "Canvas minimap",
      });
  return createElement(
    ReactFlow,
    flowProps,
    createElement(Background),
    minimap,
    props.children,
  );
}

export const ReactFlowCanvasView = memo(ReactFlowCanvasViewBase);