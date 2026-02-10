/**
 * Flow X Plugin for draw.io - V1.0
 * 
 * Professional flowchart layout tool using ELK (Eclipse Layout Kernel).
 * Automatically arranges flowcharts into textbook-style UML layout.
 * 
 * Design:
 *   algorithm: layered, direction: DOWN
 *   nodePlacement: BRANDES_KOEPF
 *   crossingMinimization: LAYER_SWEEP
 *   edgeRouting: ORTHOGONAL
 *   portConstraints: FIXED_SIDE
 *   Decision+Yes: SOUTH port, priority=10 (main trunk)
 *   Decision+No:  EAST port,  priority=1  (branch)
 * 
 * Installation:
 *   1. Run merge_elk_plugin.py to merge this file with elk.bundled.js
 *   2. In draw.io: Extras -> Plugins -> Add the merged file
 *   3. Restart draw.io
 * 
 * Usage:
 *   - Menu: Extras -> ELK Textbook Layout
 *   - Shortcut: Ctrl+Shift+L
 *   - Console: window._flowX.apply()
 * 
 * Repository: https://github.com/imasmo/flowchart-layout-tool
 * License: MIT
 */

Draw.loadPlugin(function(ui) {

    var graph = ui.editor.graph;
    var ELKClass = null;

    // Get ELK engine
    if (typeof window.__FlowX_ELK !== 'undefined') {
        ELKClass = window.__FlowX_ELK;
    } else if (typeof window.ELK !== 'undefined') {
        ELKClass = window.ELK;
    } else if (typeof ELK !== 'undefined') {
        ELKClass = ELK;
    }

    if (!ELKClass) {
        console.error('[FlowX] ELK engine not available!');
        try {
            var em = ui.menus.get('extras');
            if (em) {
                var of = em.funct;
                em.funct = function(menu, parent) {
                    if (of) of.apply(this, arguments);
                    menu.addSeparator(parent);
                    menu.addItem('ELK Not Loaded', null, function() {
                        alert('ELK engine not loaded. Please check the developer console (Ctrl+Shift+I) for details.');
                    }, parent);
                };
            }
        } catch(e) {}
        return;
    }

    // ================================================================
    //  Parse draw.io graph
    // ================================================================

    function parseGraph() {
        var model = graph.getModel();
        var parent = graph.getDefaultParent();

        var allCells = model.getDescendants(parent);

        var nodes = {};
        var edges = [];
        var edgeSet = {};

        // ---- Pass 1: Collect vertices ----
        for (var i = 0; i < allCells.length; i++) {
            var cell = allCells[i];
            if (!cell.isVertex()) continue;

            var cellStyle = (cell.getStyle() || '').toLowerCase();
            if (cellStyle.indexOf('edgelabel') >= 0) continue;

            var parentCell = model.getParent(cell);
            if (parentCell && parentCell !== parent && parentCell.isEdge && parentCell.isEdge()) continue;

            var geo = cell.getGeometry();
            if (!geo) continue;
            if (geo.relative) continue;

            var id = cell.getId();
            var nodeType = 'process';
            if (cellStyle.indexOf('rhombus') >= 0 || cellStyle.indexOf('diamond') >= 0) {
                nodeType = 'decision';
            } else if (cellStyle.indexOf('ellipse') >= 0) {
                nodeType = 'start';
            }

            nodes[id] = {
                id: id,
                type: nodeType,
                label: (cell.getValue() || '').toString(),
                width: geo.width || 120,
                height: geo.height || 36,
                cell: cell
            };
        }

        var nodeIds = Object.keys(nodes);

        // ---- Pass 2: Collect edges ----
        for (var i = 0; i < allCells.length; i++) {
            var cell = allCells[i];

            var isE = cell.isEdge();
            var isV = cell.isVertex();

            if (isE) {
                var cellId = cell.getId();

                var src = null;
                var tgt = null;

                if (typeof cell.getSource === 'function') {
                    src = cell.getSource();
                }
                if (typeof cell.getTarget === 'function') {
                    tgt = cell.getTarget();
                }

                if (!src && cell.source) {
                    src = cell.source;
                }
                if (!tgt && cell.target) {
                    tgt = cell.target;
                }

                var srcId = src ? (typeof src.getId === 'function' ? src.getId() : src) : null;
                var tgtId = tgt ? (typeof tgt.getId === 'function' ? tgt.getId() : tgt) : null;

                if (!src || !tgt) continue;
                if (!srcId || !tgtId) continue;
                if (!nodes[srcId] || !nodes[tgtId]) continue;

                var key = srcId + '->' + tgtId;
                if (edgeSet[key]) continue;
                edgeSet[key] = true;

                var label = extractEdgeLabel(cell, model);

                edges.push({
                    id: cellId,
                    source: srcId,
                    target: tgtId,
                    label: label,
                    cell: cell
                });
            }
        }

        // ---- Fallback: Collect edges via model.getEdges ----
        if (edges.length === 0) {
            for (var i = 0; i < nodeIds.length; i++) {
                var nodeCell = nodes[nodeIds[i]].cell;
                try {
                    var connEdges = model.getEdges(nodeCell);
                    if (connEdges && connEdges.length > 0) {
                        for (var j = 0; j < connEdges.length; j++) {
                            var e = connEdges[j];
                            var eSrc = e.getSource ? e.getSource() : e.source;
                            var eTgt = e.getTarget ? e.getTarget() : e.target;
                            var eSrcId = eSrc ? (eSrc.getId ? eSrc.getId() : eSrc) : null;
                            var eTgtId = eTgt ? (eTgt.getId ? eTgt.getId() : eTgt) : null;

                            if (eSrcId && eTgtId && nodes[eSrcId] && nodes[eTgtId]) {
                                var key2 = eSrcId + '->' + eTgtId;
                                if (!edgeSet[key2]) {
                                    edgeSet[key2] = true;
                                    var label2 = extractEdgeLabel(e, model);
                                    edges.push({
                                        id: e.getId(),
                                        source: eSrcId,
                                        target: eTgtId,
                                        label: label2,
                                        cell: e
                                    });
                                }
                            }
                        }
                    }
                } catch(ex) {}
            }
        }

        // ---- Fallback: Collect edges via graph.getEdges ----
        if (edges.length === 0) {
            for (var i = 0; i < nodeIds.length; i++) {
                var nodeCell = nodes[nodeIds[i]].cell;
                try {
                    var gEdges = graph.getEdges(nodeCell);
                    if (gEdges && gEdges.length > 0) {
                        for (var j = 0; j < gEdges.length; j++) {
                            var e = gEdges[j];
                            var eSrc = e.getSource ? e.getSource() : e.source;
                            var eTgt = e.getTarget ? e.getTarget() : e.target;
                            var eSrcId = eSrc ? (eSrc.getId ? eSrc.getId() : eSrc) : null;
                            var eTgtId = eTgt ? (eTgt.getId ? eTgt.getId() : eTgt) : null;

                            if (eSrcId && eTgtId && nodes[eSrcId] && nodes[eTgtId]) {
                                var key3 = eSrcId + '->' + eTgtId;
                                if (!edgeSet[key3]) {
                                    edgeSet[key3] = true;
                                    edges.push({
                                        id: e.getId(),
                                        source: eSrcId,
                                        target: eTgtId,
                                        label: extractEdgeLabel(e, model),
                                        cell: e
                                    });
                                }
                            }
                        }
                    }
                } catch(ex) {}
            }
        }

        // Infer node types by degree
        var inDeg = {}, outDeg = {};
        for (var i = 0; i < nodeIds.length; i++) { inDeg[nodeIds[i]] = 0; outDeg[nodeIds[i]] = 0; }
        for (var i = 0; i < edges.length; i++) { outDeg[edges[i].source]++; inDeg[edges[i].target]++; }
        for (var i = 0; i < nodeIds.length; i++) {
            var nid = nodeIds[i];
            if (inDeg[nid] === 0 && outDeg[nid] > 0) nodes[nid].type = 'start';
            if (outDeg[nid] === 0 && inDeg[nid] > 0) nodes[nid].type = 'end';
        }

        return { nodes: nodes, edges: edges };
    }

    function extractEdgeLabel(edgeCell, model) {
        var val = (edgeCell.getValue() || '').toString().toLowerCase().trim();
        if (val === 'y' || val === 'yes' || val === '是') return 'yes';
        if (val === 'n' || val === 'no' || val === '否') return 'no';
        var childCount = model.getChildCount(edgeCell);
        for (var i = 0; i < childCount; i++) {
            var child = model.getChildAt(edgeCell, i);
            if (!child) continue;
            var cv = (child.getValue() || '').toString().toLowerCase().trim();
            if (cv === 'y' || cv === 'yes' || cv === '是') return 'yes';
            if (cv === 'n' || cv === 'no' || cv === '否') return 'no';
        }
        return '';
    }

    // ================================================================
    //  Build ELK graph
    // ================================================================

    function buildELKGraph(parsed) {
        var nodes = parsed.nodes;
        var edges = parsed.edges;
        var elkNodes = [];
        var elkEdges = [];
        var nodeIds = Object.keys(nodes);

        for (var i = 0; i < nodeIds.length; i++) {
            var nid = nodeIds[i];
            var node = nodes[nid];
            elkNodes.push({
                id: nid, width: node.width, height: node.height,
                ports: [
                    { id: nid + '_N', properties: { 'port.side': 'NORTH' } },
                    { id: nid + '_S', properties: { 'port.side': 'SOUTH' } },
                    { id: nid + '_E', properties: { 'port.side': 'EAST' } },
                    { id: nid + '_W', properties: { 'port.side': 'WEST' } }
                ],
                properties: { 'portConstraints': 'FIXED_SIDE' }
            });
        }

        for (var i = 0; i < edges.length; i++) {
            var edge = edges[i];
            var srcNode = nodes[edge.source];
            if (!srcNode) continue;
            var srcPort = edge.source + '_S';
            var tgtPort = edge.target + '_N';
            var priority = 10;

            if (srcNode.type === 'decision') {
                if (edge.label === 'no') {
                    srcPort = edge.source + '_E';
                    priority = 1;
                }
            }

            elkEdges.push({
                id: edge.id,
                sources: [srcPort],
                targets: [tgtPort],
                properties: { 'org.eclipse.elk.layered.priority.direction': priority }
            });
        }

        return {
            id: 'root',
            layoutOptions: {
                'elk.algorithm': 'layered',
                'elk.direction': 'DOWN',
                'elk.edgeRouting': 'ORTHOGONAL',
                'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
                'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
                'elk.layered.spacing.nodeNodeBetweenLayers': '36',
                'elk.spacing.nodeNode': '50',
                'elk.spacing.edgeNode': '35',
                'elk.spacing.edgeEdge': '25',
                'elk.portConstraints': 'FIXED_SIDE',
                'elk.portAlignment.default': 'CENTER'
            },
            children: elkNodes,
            edges: elkEdges
        };
    }

    // ================================================================
    //  Run ELK layout and apply results
    // ================================================================

    function applyTextbookLayout() {
        try {
            var parsed = parseGraph();
            var nodeCount = Object.keys(parsed.nodes).length;

            if (nodeCount === 0) {
                showMessage('No shapes found', 'warning');
                return;
            }

            if (parsed.edges.length === 0) {
                showMessage('No connections found', 'error');
                return;
            }

            var elkGraph = buildELKGraph(parsed);

            var elk = new ELKClass();
            elk.layout(elkGraph).then(function(result) {

                var model = graph.getModel();
                model.beginUpdate();
                try {
                    // Apply node positions
                    var children = result.children || [];
                    for (var i = 0; i < children.length; i++) {
                        var elkNode = children[i];
                        var node = parsed.nodes[elkNode.id];
                        if (!node) continue;
                        var geo = node.cell.getGeometry();
                        if (!geo) continue;
                        var newGeo = geo.clone();
                        newGeo.x = elkNode.x;
                        newGeo.y = elkNode.y;
                        model.setGeometry(node.cell, newGeo);
                    }

                    // Apply edge routing
                    var resultEdges = result.edges || [];
                    for (var i = 0; i < resultEdges.length; i++) {
                        var elkEdge = resultEdges[i];
                        var edgeInfo = null;
                        for (var j = 0; j < parsed.edges.length; j++) {
                            if (parsed.edges[j].id === elkEdge.id) { edgeInfo = parsed.edges[j]; break; }
                        }
                        if (!edgeInfo) continue;
                        var edgeCell = edgeInfo.cell;

                        var points = [];
                        var sections = elkEdge.sections || [];
                        for (var s = 0; s < sections.length; s++) {
                            var sec = sections[s];
                            if (sec.startPoint) points.push(new mxPoint(sec.startPoint.x, sec.startPoint.y));
                            var bends = sec.bendPoints || [];
                            for (var b = 0; b < bends.length; b++) {
                                points.push(new mxPoint(bends[b].x, bends[b].y));
                            }
                            if (sec.endPoint) points.push(new mxPoint(sec.endPoint.x, sec.endPoint.y));
                        }

                        var geo = edgeCell.getGeometry();
                        if (geo) {
                            var newGeo = geo.clone();
                            newGeo.points = points.length > 0 ? points : null;
                            model.setGeometry(edgeCell, newGeo);
                        }

                        var srcSide = 'S', tgtSide = 'N';
                        if (elkEdge.sources && elkEdge.sources[0]) srcSide = elkEdge.sources[0].split('_').pop();
                        if (elkEdge.targets && elkEdge.targets[0]) tgtSide = elkEdge.targets[0].split('_').pop();
                        var exit = portXY(srcSide);
                        var entry = portXY(tgtSide);
                        var style = 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;' +
                            'jettySize=auto;html=1;' +
                            'exitX=' + exit[0] + ';exitY=' + exit[1] + ';' +
                            'entryX=' + entry[0] + ';entryY=' + entry[1] + ';entryPerimeter=0;';
                        model.setStyle(edgeCell, style);

                        var lbl = '';
                        if (edgeInfo.label === 'yes') lbl = 'Y';
                        else if (edgeInfo.label === 'no') lbl = 'N';
                        if (lbl) {
                            var hasChildLabel = false;
                            var cc = model.getChildCount(edgeCell);
                            for (var c = 0; c < cc; c++) {
                                var ch = model.getChildAt(edgeCell, c);
                                if (ch && (ch.getStyle()||'').indexOf('edgeLabel') >= 0) {
                                    hasChildLabel = true; break;
                                }
                            }
                            if (!hasChildLabel) model.setValue(edgeCell, lbl);
                        }
                    }
                } finally {
                    model.endUpdate();
                    graph.refresh();
                }

                showMessage('Textbook layout applied', 'success');

            }).catch(function(err) {
                console.error('[FlowX] ELK layout failed:', err);
                showMessage('Layout failed: ' + err.message, 'error');
            });

        } catch (error) {
            console.error('[FlowX] Error:', error);
            showMessage('Error: ' + error.message, 'error');
        }
    }

    function portXY(side) {
        return { N:[0.5,0], S:[0.5,1], E:[1,0.5], W:[0,0.5] }[side] || [0.5,1];
    }

    function showMessage(msg, type) {
        var c = { success:'#4CAF50', error:'#f44336', warning:'#ff9800', info:'#2196F3' };
        try {
            var d = document.createElement('div');
            d.style.cssText = 'position:fixed;top:20px;right:20px;padding:14px 28px;border-radius:8px;' +
                'z-index:99999;color:white;font-size:14px;font-family:Arial,sans-serif;' +
                'box-shadow:0 4px 16px rgba(0,0,0,0.2);background:'+(c[type]||c.info)+';max-width:500px;';
            d.textContent = msg;
            document.body.appendChild(d);
            setTimeout(function(){ if(d.parentNode) d.parentNode.removeChild(d); }, 3000);
        } catch(e){}
    }

    // Register menu item
    try {
        var em = ui.menus.get('extras');
        if (em) {
            var of = em.funct;
            em.funct = function(menu, parent) {
                if (of) of.apply(this, arguments);
                menu.addSeparator(parent);
                menu.addItem('ELK Textbook Layout', null, applyTextbookLayout, parent);
            };
        }
    } catch(e){}

    // Register shortcut Ctrl+Shift+L
    try {
        ui.actions.addAction('flowXLayout', applyTextbookLayout);
        if (ui.keyHandler) ui.keyHandler.bindAction(76, true, 'flowXLayout', true);
    } catch(e){}

    window._flowX = { apply: applyTextbookLayout, version: '10.1' };
});