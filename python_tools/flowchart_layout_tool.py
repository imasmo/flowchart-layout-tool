"""
Draw.io Flowchart Standardized Layout Tool - V1.0
Core Strategy:
1. BRANDES_KOEPF algorithm
2. Introduce Edge Priority:
   - Yes/default path: high weight -> enforce vertical alignment (main trunk)
   - No path: low weight -> allow detours (branches)

Repository: https://github.com/imasmo/flowchart-layout-tool
License: MIT
"""

import json
import logging
import os
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional
from xml.dom import minidom

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


# --- Data Definitions ---
class NodeType(Enum):
    START = "start"
    END = "end"
    PROCESS = "process"
    DECISION = "decision"


@dataclass
class FlowNode:
    id: str
    node_type: NodeType
    label: str
    width: float
    height: float
    x: float = 0.0
    y: float = 0.0


@dataclass
class FlowEdge:
    id: str
    source_id: str
    target_id: str
    label: str = ""
    source_side: str = "SOUTH"
    target_side: str = "NORTH"
    routing_points: List[Dict] = field(default_factory=list)


@dataclass
class FlowGraph:
    nodes: Dict[str, FlowNode] = field(default_factory=dict)
    edges: List[FlowEdge] = field(default_factory=list)


# --- Parser ---
class DrawioParser:
    def __init__(self, xml_path: str):
        self.xml_path = xml_path
        self.graph = FlowGraph()
        self.cell_map = {}
        self.namespace = ""

    def parse(self) -> FlowGraph:
        try:
            tree = ET.parse(self.xml_path)
            root = tree.getroot()
        except Exception as e:
            logger.error(f"XML parsing error: {e}")
            raise

        if "}" in root.tag:
            self.namespace = root.tag.split("}")[0] + "}"

        mxgraph_model = None
        for elem in root.iter(self.namespace + "mxGraphModel"):
            mxgraph_model = elem
            break
        if mxgraph_model is None:
            for elem in root.iter("mxGraphModel"):
                mxgraph_model = elem
                break
        if mxgraph_model is None:
            raise ValueError("Invalid draw.io file")

        for cell in mxgraph_model.iter():
             cid = cell.get("id")
             if cid: self.cell_map[cid] = cell

        for cell in self.cell_map.values():
            if self._is_edge(cell):
                self._parse_edge(cell)
            elif self._is_node(cell):
                self._parse_node(cell)

        self._extract_edge_labels()
        self._infer_node_types()
        return self.graph

    def _is_edge(self, cell) -> bool:
        return cell.get("edge") == "1" or (cell.get("source") and cell.get("target"))

    def _is_node(self, cell) -> bool:
        geo = cell.find(self.namespace + "mxGeometry") or cell.find("mxGeometry")
        cid = cell.get("id")
        if cid in ["0", "1"] or geo is None or self._is_edge(cell): return False
        style = cell.get("style", "").lower()
        if "edgelabel" in style or cell.get("connectable") == "0": return False
        parent = cell.get("parent")
        if parent and parent not in ["0", "1"]:
             p = self.cell_map.get(parent)
             if p and self._is_edge(p): return False
        return True

    def _parse_node(self, cell):
        cid = cell.get("id")
        style = cell.get("style", "")
        geo = cell.find(self.namespace + "mxGeometry") or cell.find("mxGeometry")
        w = float(geo.get("width", 120))
        h = float(geo.get("height", 60))

        ntype = NodeType.PROCESS
        s_low = style.lower()
        if "rhombus" in s_low or "diamond" in s_low: ntype = NodeType.DECISION
        elif "ellipse" in s_low: ntype = NodeType.START

        self.graph.nodes[cid] = FlowNode(id=cid, node_type=ntype, label=cell.get("value", ""), width=w, height=h)

    def _parse_edge(self, cell):
        src = cell.get("source")
        tgt = cell.get("target")
        if src and tgt:
            if not any(e.source_id == src and e.target_id == tgt for e in self.graph.edges):
                self.graph.edges.append(FlowEdge(id=cell.get("id"), source_id=src, target_id=tgt))

    def _extract_edge_labels(self):
        for edge in self.graph.edges:
            cell = self.cell_map.get(edge.id)
            if cell and cell.get("value"):
                 val = cell.get("value", "").lower()
                 if val in ["y", "yes"]: edge.label = "yes"
                 elif val in ["n", "no"]: edge.label = "no"
                 continue
            for child in self.cell_map.values():
                if child.get("parent") == edge.id and "edgeLabel" in child.get("style", ""):
                    val = child.get("value", "").lower()
                    if val in ["y", "yes"]: edge.label = "yes"
                    elif val in ["n", "no"]: edge.label = "no"
                    break

    def _infer_node_types(self):
        ins = {n:0 for n in self.graph.nodes}
        outs = {n:0 for n in self.graph.nodes}
        for e in self.graph.edges:
            if e.source_id in outs: outs[e.source_id]+=1
            if e.target_id in ins: ins[e.target_id]+=1
        for nid, node in self.graph.nodes.items():
            if ins[nid]==0 and outs[nid]>0: node.node_type = NodeType.START
            if outs[nid]==0 and ins[nid]>0: node.node_type = NodeType.END


# --- Core Engine ---
class ELKLayoutEngine:
    NODE_SPACING = 50.0
    LAYER_SPACING = 36.0

    def __init__(self, node_spacing: float = None, layer_spacing: float = None):
        if node_spacing: self.NODE_SPACING = node_spacing
        if layer_spacing: self.LAYER_SPACING = layer_spacing

    def layout(self, graph: FlowGraph) -> FlowGraph:
        logger.info("Starting layout computation ...")
        elk_graph = self._build_elk_graph(graph)
        result = self._call_elk_robust(elk_graph)
        self._apply_layout(graph, result)
        logger.info("Layout computation completed")
        return graph

    def _build_elk_graph(self, graph: FlowGraph) -> dict:
        elk_nodes = []
        elk_edges = []

        # Nodes and ports
        for nid, node in graph.nodes.items():
            ports = [
                {"id": f"{nid}_N", "properties": {"port.side": "NORTH"}},
                {"id": f"{nid}_S", "properties": {"port.side": "SOUTH"}},
                {"id": f"{nid}_E", "properties": {"port.side": "EAST"}},
                {"id": f"{nid}_W", "properties": {"port.side": "WEST"}},
            ]
            elk_nodes.append({
                "id": nid, "width": node.width, "height": node.height,
                "ports": ports,
                "properties": {"portConstraints": "FIXED_SIDE"}
            })

        # Edges
        for i, edge in enumerate(graph.edges):
            src_node = graph.nodes.get(edge.source_id)
            if not src_node: continue

            src_port = f"{edge.source_id}_S"
            tgt_port = f"{edge.target_id}_N"

            # Weight logic: default to high priority (main trunk)
            edge_priority = 10

            if src_node.node_type == NodeType.START:
                src_port = f"{edge.source_id}_S"
            elif src_node.node_type == NodeType.DECISION:
                if edge.label == "no":
                    src_port = f"{edge.source_id}_E"
                    edge_priority = 1 # No branch: low priority, allow detours
                else:
                    src_port = f"{edge.source_id}_S"
                    edge_priority = 10 # Yes branch: high priority, enforce straight line

            elk_edges.append({
                "id": edge.id or f"e{i}",
                "sources": [src_port],
                "targets": [tgt_port],
                "properties": {
                    # Key modification: tell ELK the importance of this edge
                    "org.eclipse.elk.layered.priority.direction": edge_priority
                }
            })

        return {
            "id": "root",
            "layoutOptions": {
                "elk.algorithm": "layered",
                "elk.direction": "DOWN",
                "elk.edgeRouting": "ORTHOGONAL",

                # Revert to V1.1's core algorithm for compact aesthetics
                "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",

                # Auxiliary alignment strategy
                "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",

                # Spacing fine-tuning
                "elk.layered.spacing.nodeNodeBetweenLayers": str(self.LAYER_SPACING),
                "elk.spacing.nodeNode": str(self.NODE_SPACING),
                "elk.spacing.edgeNode": "35.0",
                "elk.spacing.edgeEdge": "25.0",

                "elk.portConstraints": "FIXED_SIDE",
                "elk.portAlignment.default": "CENTER"
            },
            "children": elk_nodes,
            "edges": elk_edges,
        }

    def _call_elk_robust(self, elk_graph: dict) -> dict:
        try:
            # 1. Check elkjs availability
            project_root = Path(__file__).parent.parent
            elkjs_path = project_root / "node_modules" / "elkjs"

            if not elkjs_path.exists() and not (Path(os.getcwd()) / "node_modules" / "elkjs").exists():
                 subprocess.run(["node", "-e", "require('elkjs')"], check=True, capture_output=True)

            # 2. JS script
            js_code = f"""
            const ELK = require('elkjs');
            const elk = new ELK();
            const graph = {json.dumps(elk_graph)};
            elk.layout(graph)
                .then(r => console.log(JSON.stringify(r)))
                .catch(e => {{ console.error(e); process.exit(1); }});
            """

            with tempfile.NamedTemporaryFile(mode="w", suffix=".js", delete=False, encoding="utf-8") as f:
                f.write(js_code)
                js_path = f.name

            # 3. Path resolution
            real_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            if not os.path.exists(os.path.join(real_project_root, "node_modules")):
                real_project_root = os.getcwd()

            env = os.environ.copy()
            env["NODE_PATH"] = os.path.join(real_project_root, "node_modules")

            # 4. Execute
            result = subprocess.run(
                ["node", js_path],
                capture_output=True, text=True, timeout=30,
                env=env
            )

            try: os.unlink(js_path)
            except: pass

            if result.returncode != 0:
                logger.error(f"ELK failed: {result.stderr}")
                raise RuntimeError(result.stderr)

            return json.loads(result.stdout)

        except Exception as e:
            logger.error(f"ELK invocation error: {e}")
            raise

    def _apply_layout(self, graph: FlowGraph, elk_result: dict):
        scale = 1.0
        for child in elk_result.get("children", []):
            nid = child["id"]
            if nid in graph.nodes:
                graph.nodes[nid].x = child["x"] * scale
                graph.nodes[nid].y = child["y"] * scale

        for edge_res in elk_result.get("edges", []):
            eid = edge_res["id"]
            edge = next((e for e in graph.edges if e.id == eid), None)
            if not edge: continue

            points = []
            for sec in edge_res.get("sections", []):
                points.append(sec["startPoint"])
                if "bendPoints" in sec: points.extend(sec["bendPoints"])
                points.append(sec["endPoint"])
            edge.routing_points = points

            src_p = edge_res.get("sources", ["_S"])[0]
            tgt_p = edge_res.get("targets", ["_N"])[0]
            edge.source_side = src_p.split("_")[-1]
            edge.target_side = tgt_p.split("_")[-1]


# --- Generator ---
class DrawioGenerator:
    def __init__(self, graph: FlowGraph):
        self.graph = graph

    def generate(self, output_path: str):
        mxfile = ET.Element("mxfile", {"host": "elk-v4", "version": "4.0"})
        diagram = ET.SubElement(mxfile, "diagram", {"name": "Flowchart"})
        model = ET.SubElement(diagram, "mxGraphModel", {"dx":"1200", "dy":"1200", "grid":"1", "gridSize":"10"})
        root = ET.SubElement(model, "root")
        ET.SubElement(root, "mxCell", {"id": "0"})
        ET.SubElement(root, "mxCell", {"id": "1", "parent": "0"})

        for node in self.graph.nodes.values():
            self._write_node(root, node)

        for edge in self.graph.edges:
            self._write_edge(root, edge)

        xml_str = minidom.parseString(ET.tostring(mxfile)).toprettyxml(indent="  ")
        xml_str = "\n".join([line for line in xml_str.split("\n") if line.strip()])

        with open(output_path, "w", encoding="utf-8") as f:
            f.write(xml_str)

    def _write_node(self, root, node: FlowNode):
        base_style = "html=1;whiteSpace=wrap;"
        styles = {
            NodeType.START: base_style + "ellipse;fillColor=#d5e8d4;strokeColor=#82b366;",
            NodeType.END: base_style + "ellipse;fillColor=#f8cecc;strokeColor=#b85450;",
            NodeType.PROCESS: base_style + "rounded=0;fillColor=#dae8fc;strokeColor=#6c8ebf;",
            NodeType.DECISION: base_style + "rhombus;fillColor=#fff2cc;strokeColor=#d6b656;"
        }
        cell = ET.SubElement(root, "mxCell", {
            "id": node.id, "value": node.label,
            "style": styles.get(node.node_type, styles[NodeType.PROCESS]),
            "vertex": "1", "parent": "1"
        })
        ET.SubElement(cell, "mxGeometry", {
            "x": str(node.x), "y": str(node.y),
            "width": str(node.width), "height": str(node.height), "as": "geometry"
        })

    def _write_edge(self, root, edge: FlowEdge):
        pmap = { "N": ("0.5", "0"), "S": ("0.5", "1"), "E": ("1", "0.5"), "W": ("0", "0.5") }
        ex, ey = pmap.get(edge.source_side, ("0.5", "1"))
        ix, iy = pmap.get(edge.target_side, ("0.5", "0"))

        style = (f"edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;"
                 f"exitX={ex};exitY={ey};entryX={ix};entryY={iy};entryPerimeter=0;")

        lbl = ""
        if edge.label == "yes": lbl = "Y"
        elif edge.label == "no": lbl = "N"

        cell = ET.SubElement(root, "mxCell", {
            "id": edge.id, "value": lbl, "style": style,
            "edge": "1", "parent": "1", "source": edge.source_id, "target": edge.target_id
        })
        geo = ET.SubElement(cell, "mxGeometry", {"relative": "1", "as": "geometry"})

        if edge.routing_points:
            pts = ET.SubElement(geo, "Array", {"as": "points"})
            for p in edge.routing_points:
                ET.SubElement(pts, "mxPoint", {"x": str(p["x"]), "y": str(p["y"])})


def main():
    import argparse
    parser = argparse.ArgumentParser(description="UML Flowchart Layout Tool")
    parser.add_argument("input", help="Input drawio xml")
    parser.add_argument("output", nargs="?", help="Output file path")
    args = parser.parse_args()

    try: subprocess.run(["node", "-v"], check=True, stdout=subprocess.DEVNULL)
    except:
        logger.error("Node.js is not installed")
        sys.exit(1)

    out_file = args.output
    if not out_file:
        out_file = str(Path(args.input).parent / f"{Path(args.input).stem}_textbook.drawio")

    try:
        parser = DrawioParser(args.input)
        graph = parser.parse()

        layout = ELKLayoutEngine()
        graph = layout.layout(graph)

        gen = DrawioGenerator(graph)
        gen.generate(out_file)

        logger.info(f"Done: {out_file}")
    except Exception as e:
        logger.error(f"Failed: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()