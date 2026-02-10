# Draw.io Flowchart UML Standard Layout Tool

A toolkit for automatically adjusting draw.io flowchart files to UML standard layout conventions.

## Features

- **Python Tools**: Command-line utilities for batch processing draw.io XML files
- **Draw.io Plugins**: GUI integration for the draw.io desktop application
- **UML Standard Layout**: Applies professional UML layout conventions to flowcharts
- **ELK Layout Engine**: Powered by the Eclipse Layout Kernel (ELK) for high-quality graph layout
- **Edge Priority System**: Intelligent routing with priority-based edge alignment (Yes/No branches)

## 1. Python Tools

Python command-line tool that transforms draw.io flowchart files into UML standard layout format.

### Usage

```bash
python flowchart_layout_tool.py input.drawio [output.drawio]
```

The tool analyzes the flowchart structure, applies UML layout conventions, and generates a properly arranged diagram.

### Key Algorithms
- **BRANDES_KOEPF algorithm** for node placement
- **Edge priority system**: High priority for "Yes" paths (main trunk), low priority for "No" paths (branches)
- **Orthogonal edge routing** with fixed port constraints

## 2. Draw.io Plugins

Draw.io extension that adds UML layout functionality directly to the draw.io desktop GUI.

### Installation

1. Download the required ELK library:
```bash
curl -o elk.bundled.js https://cdn.jsdelivr.net/npm/elkjs@0.11.0/lib/elk.bundled.js
```

2. Enable plugins in draw.io desktop version:
```bash
./draw.io.exe --enable-plugins
```

3. Install the plugin files in your draw.io plugins directory

### Plugin Files
- `flow_x_plugin.js` - Main plugin file
- `flow_x_plugin_with_elk.js` - Plugin with embedded ELK library
- `merge_elk_plugin.py` - Utility to merge ELK with plugin

## 3. Demo

Example files demonstrating the layout transformation:

- `demo/demo.drawio` - Original flowchart
- `demo/demo_output.drawio` - After applying UML layout
- `demo/demo_output2.drawio` - Additional example

## Technical Details

### Layout Configuration
- Direction: DOWN (top-to-bottom flow)
- Node spacing: 50px
- Layer spacing: 36px
- Edge routing: Orthogonal
- Port constraints: Fixed side
- Node placement: BRANDES_KOEPF strategy

### Node Type Detection
Automatically identifies:
- **Start nodes** (ellipses with no incoming edges)
- **End nodes** (ellipses with no outgoing edges)
- **Decision nodes** (diamond/rhombus shapes)
- **Process nodes** (rectangles)

### Edge Label Processing
Recognizes "Yes"/"No" edge labels to apply appropriate routing priorities.

## Requirements

- **Python Tool**: Python 3.7+, Node.js (for ELK engine)
- **Draw.io Plugin**: draw.io desktop version 14+ with plugin support

## License

MIT License - See repository for details.

## Repository

https://github.com/imasmo/flowchart-layout-tool

## Contributing

Contributions are welcome! Please submit issues and pull requests on GitHub.