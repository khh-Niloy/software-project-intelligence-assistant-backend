export interface CodeChunkItem {
  repoName: string;
  filePath: string;
  language: string;
  className: string;
  functionName: string;
  startLine: number;
  endLine: number;
  content: string;
}

export interface ChunkFileInput {
  repoName: string;
  filePath: string;
  language: string;
  content: string;
}

interface RawLogicalBlock {
  className: string;
  functionName: string;
  startLine: number; // 1-indexed
  endLine: number; // 1-indexed
  lines: string[];
}

const CONTROL_KEYWORDS = new Set([
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'catch',
  'finally',
  'try',
  'return',
  'throw',
  'new',
  'typeof',
  'instanceof',
  'void',
  'delete',
  'await',
  'yield',
  'import',
  'export',
  'from',
  'require',
  'super',
]);

export class CodeChunker {
  static readonly SMALL_FILE_THRESHOLD = 600;
  static readonly MAX_CHUNK_CHARS = 2000;
  static readonly TARGET_SUBCHUNK_CHARS = 1500;
  static readonly OVERLAP_TARGET_CHARS = 180;

  static detectLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
        return 'typescript';
      case 'js':
      case 'jsx':
      case 'mjs':
      case 'cjs':
        return 'javascript';
      case 'md':
        return 'markdown';
      case 'json':
        return 'json';
      default:
        return 'text';
    }
  }

  /**
   * Main entry point for code-aware chunking of a file.
   */
  static chunkFileContent(input: ChunkFileInput): CodeChunkItem[] {
    const { repoName, filePath, language, content } = input;
    const normalizedContent = content.replace(/\r\n/g, '\n');

    if (!normalizedContent.trim()) {
      return [];
    }

    const lines = normalizedContent.split('\n');

    // Rule 1: Small file (<= 600 chars) -> Single chunk
    if (normalizedContent.length <= this.SMALL_FILE_THRESHOLD) {
      const { className, functionName } =
        this.detectPrimarySymbols(normalizedContent);
      return [
        {
          repoName,
          filePath,
          language,
          className,
          functionName,
          startLine: 1,
          endLine: lines.length,
          content: normalizedContent,
        },
      ];
    }

    let rawBlocks: RawLogicalBlock[] = [];

    if (language === 'typescript' || language === 'javascript') {
      rawBlocks = this.extractCodeBlocks(lines);
    } else if (language === 'markdown') {
      rawBlocks = this.extractMarkdownBlocks(lines);
    } else {
      // JSON or other text
      rawBlocks = [
        {
          className: '',
          functionName: '',
          startLine: 1,
          endLine: lines.length,
          lines,
        },
      ];
    }

    // Post-process blocks: apply line-aligned sub-chunking with overlap if any block > MAX_CHUNK_CHARS
    const finalChunks: CodeChunkItem[] = [];
    for (const block of rawBlocks) {
      const blockContent = block.lines.join('\n');
      if (!blockContent.trim()) {
        continue;
      }

      if (blockContent.length <= this.MAX_CHUNK_CHARS) {
        finalChunks.push({
          repoName,
          filePath,
          language,
          className: block.className,
          functionName: block.functionName,
          startLine: block.startLine,
          endLine: block.endLine,
          content: blockContent,
        });
      } else {
        const subChunks = this.splitOversizedBlockWithOverlap(block, {
          repoName,
          filePath,
          language,
        });
        finalChunks.push(...subChunks);
      }
    }

    return finalChunks;
  }

  /**
   * Extracts primary className and functionName for small single-chunk files.
   */
  private static detectPrimarySymbols(code: string): {
    className: string;
    functionName: string;
  } {
    const lines = code.split('\n');
    let className = '';
    let functionName = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!className) {
        const cMatch = trimmed.match(
          /(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/,
        );
        if (cMatch) {
          className = cMatch[1];
        }
      }
      if (!functionName) {
        const fnName = this.matchFunctionName(trimmed, Boolean(className));
        if (fnName) {
          functionName = fnName;
        }
      }
    }

    return { className, functionName };
  }

  /**
   * Matches a function or method declaration on a trimmed line.
   */
  private static matchFunctionName(
    trimmed: string,
    insideClass: boolean,
  ): string | null {
    if (
      !trimmed ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('@')
    ) {
      return null;
    }

    // 1. Standard function declaration: [export] [default] [async] function foo(...)
    const stdFunc = trimmed.match(
      /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*(?:<[^>]*>)?\s*\(/,
    );
    if (stdFunc && !CONTROL_KEYWORDS.has(stdFunc[1])) {
      return stdFunc[1];
    }

    // 2. Arrow function declaration: [export] const/let/var foo = [async] (...) =>
    const arrowFunc = trimmed.match(
      /^(?:export\s+)?(?:(?:const|let|var|public|private|protected|readonly|static)\s+)+([A-Za-z0-9_$]+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:<[^>]*>)?\s*(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*(?::[^=]+)?=>/,
    );
    if (arrowFunc && !CONTROL_KEYWORDS.has(arrowFunc[1])) {
      return arrowFunc[1];
    }

    // 3. Class method declaration (when inside a class)
    if (insideClass) {
      // e.g. async login(dto: LoginDto): Promise<User> {
      // or @Get() followed by getTree(
      const methodMatch = trimmed.match(
        /^(?:(?:public|private|protected|readonly|static|override|abstract|async|get|set)\s+)*([A-Za-z0-9_$]+)\s*(?:<[^>]*>)?\s*\(/,
      );
      if (methodMatch) {
        const candidate = methodMatch[1];
        if (
          !CONTROL_KEYWORDS.has(candidate) &&
          !trimmed.endsWith(';') &&
          (trimmed.includes('{') ||
            trimmed.endsWith(')') ||
            trimmed.endsWith(',') ||
            trimmed.includes('):'))
        ) {
          return candidate;
        }
      }
    }

    return null;
  }

  /**
   * Counts net brace delta `{` minus `}` on a line, ignoring comments and string literals.
   */
  private static countBraceDelta(line: string): {
    openCount: number;
    closeCount: number;
    delta: number;
  } {
    let openCount = 0;
    let closeCount = 0;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const prev = i > 0 ? line[i - 1] : '';

      if (
        ch === '/' &&
        line[i + 1] === '/' &&
        !inSingle &&
        !inDouble &&
        !inTemplate
      ) {
        break; // single-line comment
      }

      if (ch === "'" && prev !== '\\' && !inDouble && !inTemplate) {
        inSingle = !inSingle;
      } else if (ch === '"' && prev !== '\\' && !inSingle && !inTemplate) {
        inDouble = !inDouble;
      } else if (ch === '`' && prev !== '\\' && !inSingle && !inDouble) {
        inTemplate = !inTemplate;
      } else if (!inSingle && !inDouble && !inTemplate) {
        if (ch === '{') openCount++;
        else if (ch === '}') closeCount++;
      }
    }

    return {
      openCount,
      closeCount,
      delta: openCount - closeCount,
    };
  }

  /**
   * Extracts structural blocks (classes, methods, functions, module headers) from TS/JS lines.
   */
  private static extractCodeBlocks(lines: string[]): RawLogicalBlock[] {
    const blocks: RawLogicalBlock[] = [];

    let currentClassName = '';
    let classBraceDepth: number | null = null;
    let braceDepth = 0;

    let activeFnName: string | null = null;
    let activeFnClassName = '';
    let activeFnStartLine = 1;
    let activeFnStartDepth = 0;
    let activeFnSawOpenBrace = false;

    let bufferStartLine = 1;
    let bufferLines: string[] = [];
    let bufferClassName = '';

    // Track decorator / comment prefix lines that belong to the upcoming declaration
    let pendingPrefixStartLine: number | null = null;

    const flushBuffer = (endLine: number) => {
      if (bufferLines.length === 0) return;
      const text = bufferLines.join('\n').trim();
      if (text.length > 0) {
        blocks.push({
          className: bufferClassName,
          functionName: '',
          startLine: bufferStartLine,
          endLine,
          lines: [...bufferLines],
        });
      }
      bufferLines = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      const trimmed = line.trim();
      const { openCount, delta } = this.countBraceDelta(line);

      // If we are currently inside a function/method block, accumulate lines until its closing brace
      if (activeFnName !== null) {
        bufferLines.push(line);
        if (openCount > 0) {
          activeFnSawOpenBrace = true;
        }
        braceDepth += delta;

        if (activeFnSawOpenBrace && braceDepth <= activeFnStartDepth) {
          blocks.push({
            className: activeFnClassName,
            functionName: activeFnName,
            startLine: activeFnStartLine,
            endLine: lineNum,
            lines: [...bufferLines],
          });
          bufferLines = [];
          activeFnName = null;
          activeFnSawOpenBrace = false;
          bufferStartLine = lineNum + 1;
          bufferClassName = currentClassName;
        }
        continue;
      }

      // Check for decorator or JSDoc comment lines preceding a method/class
      const isPrefixLine =
        trimmed.startsWith('@') ||
        trimmed.startsWith('/**') ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('*/') ||
        trimmed.startsWith('//');

      if (isPrefixLine && pendingPrefixStartLine === null) {
        pendingPrefixStartLine = lineNum;
      } else if (!isPrefixLine && trimmed !== '') {
        // We'll use pendingPrefixStartLine if this line is a class or function declaration
      }

      // Check for class declaration when not inside a function
      const classMatch = trimmed.match(
        /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/,
      );
      if (classMatch) {
        currentClassName = classMatch[1];
        classBraceDepth = braceDepth;
        bufferClassName = currentClassName;
        pendingPrefixStartLine = null;
      }

      // Check for function or method declaration
      const insideClass =
        currentClassName !== '' &&
        classBraceDepth !== null &&
        braceDepth > classBraceDepth;

      const detectedFn = this.matchFunctionName(trimmed, insideClass);

      if (detectedFn) {
        // If there were decorator/comment lines at the end of bufferLines, detach them for this function
        let fnLines: string[] = [];
        let fnStartLine = lineNum;

        if (
          pendingPrefixStartLine !== null &&
          pendingPrefixStartLine >= bufferStartLine
        ) {
          const prefixCount = lineNum - pendingPrefixStartLine;
          if (prefixCount > 0 && prefixCount <= bufferLines.length) {
            fnLines = bufferLines.splice(
              bufferLines.length - prefixCount,
              prefixCount,
            );
            fnStartLine = pendingPrefixStartLine;
          }
        }

        // Flush any remaining preceding buffer lines before this function
        if (bufferLines.length > 0) {
          flushBuffer(fnStartLine - 1);
        }

        activeFnName = detectedFn;
        activeFnClassName = currentClassName;
        activeFnStartLine = fnStartLine;
        activeFnStartDepth = braceDepth;
        activeFnSawOpenBrace = openCount > 0;
        bufferLines = [...fnLines, line];
        braceDepth += delta;
        pendingPrefixStartLine = null;

        // Check if single-line function/method (opened and closed on the same line)
        if (activeFnSawOpenBrace && braceDepth <= activeFnStartDepth) {
          blocks.push({
            className: activeFnClassName,
            functionName: activeFnName,
            startLine: activeFnStartLine,
            endLine: lineNum,
            lines: [...bufferLines],
          });
          bufferLines = [];
          activeFnName = null;
          activeFnSawOpenBrace = false;
          bufferStartLine = lineNum + 1;
          bufferClassName = currentClassName;
        }
        continue;
      }

      if (!isPrefixLine && trimmed !== '') {
        pendingPrefixStartLine = null;
      }

      // Accumulate normal line in buffer
      if (bufferLines.length === 0) {
        bufferStartLine = lineNum;
        bufferClassName = currentClassName;
      }
      bufferLines.push(line);
      braceDepth += delta;

      // Check if we just closed the active class
      if (
        currentClassName !== '' &&
        classBraceDepth !== null &&
        braceDepth <= classBraceDepth
      ) {
        flushBuffer(lineNum);
        currentClassName = '';
        classBraceDepth = null;
        bufferStartLine = lineNum + 1;
        bufferClassName = '';
      }
    }

    // Flush any remaining lines at EOF
    if (bufferLines.length > 0) {
      if (activeFnName !== null) {
        blocks.push({
          className: activeFnClassName,
          functionName: activeFnName,
          startLine: activeFnStartLine,
          endLine: lines.length,
          lines: [...bufferLines],
        });
      } else {
        flushBuffer(lines.length);
      }
    }

    // Handle tiny trailing/closing-brace-only blocks (e.g., class closing `}`)
    const mergedBlocks: RawLogicalBlock[] = [];
    for (const b of blocks) {
      const trimmedContent = b.lines.join('\n').trim();
      if (
        !b.functionName &&
        trimmedContent.length <= 15 &&
        /^[};)\s]*$/.test(trimmedContent)
      ) {
        if (
          mergedBlocks.length > 0 &&
          !mergedBlocks[mergedBlocks.length - 1].functionName
        ) {
          const prev = mergedBlocks[mergedBlocks.length - 1];
          prev.lines.push(...b.lines);
          prev.endLine = b.endLine;
        }
        // Otherwise omit standalone class closing brace so method endLine stays exact
      } else {
        mergedBlocks.push(b);
      }
    }

    return mergedBlocks;
  }

  /**
   * Splits Markdown files by heading sections (#, ##, ###).
   */
  private static extractMarkdownBlocks(lines: string[]): RawLogicalBlock[] {
    const blocks: RawLogicalBlock[] = [];
    let currentHeading = '';
    let startLine = 1;
    let currentLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      const headingMatch = line.match(/^#{1,3}\s+(.+)$/);

      if (headingMatch && currentLines.length > 0) {
        blocks.push({
          className: '',
          functionName: currentHeading,
          startLine,
          endLine: lineNum - 1,
          lines: currentLines,
        });
        currentHeading = headingMatch[1].trim();
        startLine = lineNum;
        currentLines = [line];
      } else {
        if (headingMatch && !currentHeading) {
          currentHeading = headingMatch[1].trim();
        }
        currentLines.push(line);
      }
    }

    if (currentLines.length > 0) {
      blocks.push({
        className: '',
        functionName: currentHeading,
        startLine,
        endLine: lines.length,
        lines: currentLines,
      });
    }

    return blocks;
  }

  /**
   * Splits an oversized logical block (> 2000 chars) into smaller sub-chunks
   * with line-aligned overlap (~180 chars / 3-5 whole lines), preserving startLine and endLine.
   */
  private static splitOversizedBlockWithOverlap(
    block: RawLogicalBlock,
    meta: { repoName: string; filePath: string; language: string },
  ): CodeChunkItem[] {
    const subChunks: CodeChunkItem[] = [];
    const totalLines = block.lines.length;
    let idx = 0;

    while (idx < totalLines) {
      let charCount = 0;
      let endIdx = idx;

      while (
        endIdx < totalLines &&
        (charCount + block.lines[endIdx].length + 1 <=
          this.TARGET_SUBCHUNK_CHARS ||
          endIdx === idx)
      ) {
        charCount += block.lines[endIdx].length + 1;
        endIdx++;
      }

      const sliceLines = block.lines.slice(idx, endIdx);
      const subStartLine = block.startLine + idx;
      const subEndLine = block.startLine + endIdx - 1;

      subChunks.push({
        repoName: meta.repoName,
        filePath: meta.filePath,
        language: meta.language,
        className: block.className,
        functionName: block.functionName,
        startLine: subStartLine,
        endLine: subEndLine,
        content: sliceLines.join('\n'),
      });

      if (endIdx >= totalLines) {
        break;
      }

      // Compute line-aligned overlap (~180 chars, between 2 and 6 lines)
      let overlapChars = 0;
      let overlapLines = 0;
      for (let back = endIdx - 1; back > idx && overlapLines < 6; back--) {
        overlapChars += block.lines[back].length + 1;
        overlapLines++;
        if (overlapChars >= this.OVERLAP_TARGET_CHARS && overlapLines >= 3) {
          break;
        }
      }

      const nextIdx = Math.max(idx + 1, endIdx - overlapLines);
      idx = nextIdx;
    }

    return subChunks;
  }
}
