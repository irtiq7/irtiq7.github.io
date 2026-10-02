![LOCC Mapper logo](images/posts/locc-mapper-logo.webp)

When I start designing or rewriting code, two questions come first: how big is the codebase, and how are its files connected? I built **LOCC Mapper** (Line of Code and Connectivity Mapper) to answer both quickly. It helps me understand the structure of a project and estimate how much code a change will touch before I commit to it.

Source code: [github.com/irtiq7/LOCC_Mapper](https://github.com/irtiq7/LOCC_Mapper)

## Features

- **Line-of-code analysis.** Counts lines per file type, with separate totals for code, comment and blank lines.
- **File relationship mapping.** Visualizes how the files in a codebase are connected, which is especially useful when porting or refactoring code.
- **Filtering.** Select a file type to list the individual files and their line counts.
- **Two ways to run it.** A desktop interface built with Tkinter, and a Bash script for the command line.

![LOCC Mapper window with line counts per file type and a second window listing the C files](images/posts/locc-mapper-gui.webp)
*LOCC Mapper summarizing a small C project by file type, with the files of type `c` listed in a separate window.*

## Getting started

Clone the repository:

```bash
git clone https://github.com/irtiq7/LOCC_Mapper.git
```

**Command line.** In the `Bash` folder, make the script executable and point it at a directory:

```bash
chmod +x locc.sh
./locc.sh "directory"
```

**Desktop interface.** Install the Python dependencies and start the app:

```bash
pip install matplotlib networkx
python LOCC_Mapper.py
```

## Why it helps

Knowing the size and shape of a codebase up front makes it easier to plan work, find the files that matter most, and share a clear picture of a project's structure with collaborators.
