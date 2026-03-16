import { test, expect, describe, beforeAll } from "bun:test"
import { OpenCodeIgnore } from "./index"
import path from "path"

// Test data directory is the project root for all tests
const TEST_PROJECT_ROOT = path.join(process.cwd(), "test-data")

// Helper to create plugin instance
async function createPlugin(projectRoot = TEST_PROJECT_ROOT) {
  return await OpenCodeIgnore({
    project: {} as any,
    client: {} as any,
    $: {} as any,
    directory: projectRoot,
    worktree: projectRoot,
  })
}

// Helper to call hook
async function callHook(hook: any, tool: string, args: any) {
  return await hook(
    { tool, sessionID: "test", callID: "test" },
    { args }
  )
}

describe("OpenCodeIgnore Plugin", () => {
  test("plugin loads and registers hook", async () => {
    const plugin = await createPlugin()
    expect(plugin["tool.execute.before"]).toBeDefined()
    expect(typeof plugin["tool.execute.before"]).toBe("function")
  })

  test("graceful degradation - missing ignore file allows all", async () => {
    const tempDir = "/tmp/test-no-ignore-" + Date.now()
    const plugin = await createPlugin(tempDir)
    const hook = plugin["tool.execute.before"]!
    
    // Should not throw even though no ignore file exists
    expect(callHook(hook, "read", { filePath: "secrets.json" })).resolves.toBeUndefined()
  })

  test("project root (.) is always allowed", async () => {
    const plugin = await createPlugin()
    const hook = plugin["tool.execute.before"]!
    
    // All directory operations on root should be allowed
    expect(callHook(hook, "list", { path: "." })).resolves.toBeUndefined()
    expect(callHook(hook, "glob", { path: "." })).resolves.toBeUndefined()
    expect(callHook(hook, "grep", { path: "." })).resolves.toBeUndefined()
  })
})

describe("Ignore File Loading", () => {
  test("uses .ignore when available", async () => {
    // Current project has .ignore, should block secrets.json
    const plugin = await createPlugin()
    const hook = plugin["tool.execute.before"]!
    
    expect(callHook(hook, "read", { filePath: "secrets.json" }))
      .rejects.toThrow(/Access denied/)
  })

  test("loads .ignore file correctly", async () => {
    const tempDir = "/tmp/test-ignore-" + Date.now()
    
    // Create temp dir with .ignore
    await Bun.write(tempDir + "/.ignore", "blocked.txt\n")
    
    const plugin = await createPlugin(tempDir)
    const hook = plugin["tool.execute.before"]!
    
    expect(callHook(hook, "read", { filePath: "blocked.txt" }))
      .rejects.toThrow(/Access denied/)
    expect(callHook(hook, "read", { filePath: "allowed.txt" }))
      .resolves.toBeUndefined()
  })
})

describe("File I/O Tools Protection", () => {
  let plugin: any
  let hook: any

  beforeAll(async () => {
    plugin = await createPlugin()
    hook = plugin["tool.execute.before"]
  })

  describe("read tool", () => {
    test("allows access to allowed files", async () => {
      expect(callHook(hook, "read", { filePath: "index.ts" })).resolves.toBeUndefined()
      expect(callHook(hook, "read", { filePath: "README.md" })).resolves.toBeUndefined()
    })

    test("blocks secrets.json", async () => {
      expect(callHook(hook, "read", { filePath: "secrets.json" }))
        .rejects.toThrow(/Access denied.*secrets\.json/)
    })

    test("blocks credentials.json", async () => {
      expect(callHook(hook, "read", { filePath: "credentials.json" }))
        .rejects.toThrow(/Access denied.*credentials\.json/)
    })

    test("blocks .env files", async () => {
      expect(callHook(hook, "read", { filePath: ".env" }))
        .rejects.toThrow(/Access denied.*\.env/)
      expect(callHook(hook, "read", { filePath: ".env.local" }))
        .rejects.toThrow(/Access denied.*\.env\.local/)
      expect(callHook(hook, "read", { filePath: "production.env" }))
        .rejects.toThrow(/Access denied.*production\.env/)
    })

    test("blocks certificate files", async () => {
      expect(callHook(hook, "read", { filePath: "server.crt" }))
        .rejects.toThrow(/Access denied.*server\.crt/)
      expect(callHook(hook, "read", { filePath: "ca.pem" }))
        .rejects.toThrow(/Access denied.*ca\.pem/)
      expect(callHook(hook, "read", { filePath: "private.key" }))
        .rejects.toThrow(/Access denied.*private\.key/)
    })

    test("blocks id_rsa", async () => {
      expect(callHook(hook, "read", { filePath: "id_rsa" }))
        .rejects.toThrow(/Access denied.*id_rsa/)
    })
  })

  describe("write tool", () => {
    test("allows writing to allowed files", async () => {
      expect(callHook(hook, "write", { filePath: "output.txt" })).resolves.toBeUndefined()
    })

    test("blocks writing to secrets.json", async () => {
      expect(callHook(hook, "write", { filePath: "secrets.json" }))
        .rejects.toThrow(/Access denied.*secrets\.json/)
    })
  })

  describe("edit tool", () => {
    test("allows editing allowed files", async () => {
      expect(callHook(hook, "edit", { filePath: "index.ts" })).resolves.toBeUndefined()
    })

    test("blocks editing secrets.json", async () => {
      expect(callHook(hook, "edit", { filePath: "secrets.json" }))
        .rejects.toThrow(/Access denied.*secrets\.json/)
    })
  })
})

describe("Search/List Tools Protection", () => {
  let plugin: any
  let hook: any

  beforeAll(async () => {
    plugin = await createPlugin()
    hook = plugin["tool.execute.before"]
  })

  describe("glob tool", () => {
    test("allows glob on project root", async () => {
      expect(callHook(hook, "glob", {path: "."})).resolves.toBeUndefined()
    })

    test("allows glob on allowed directories", async () => {
      expect(callHook(hook, "glob", { path: "src" })).resolves.toBeUndefined()
    })

    test("blocks glob on to/ignore (relative path)", async () => {
      expect(callHook(hook, "glob", { path: "to/ignore" }))
        .rejects.toThrow(/Access denied.*to\/ignore/)
    })

    test("defaults to . when path not provided", async () => {
      expect(callHook(hook, "glob", {})).resolves.toBeUndefined()
    })
  })

  describe("grep tool", () => {
    test("allows grep on project root", async () => {
      expect(callHook(hook, "grep", { path: "." })).resolves.toBeUndefined()
    })

    test("allows grep on allowed directories", async () => {
      expect(callHook(hook, "grep", { path: "src" })).resolves.toBeUndefined()
    })

    test("allows grep on bamboo-specs directory (pattern only blocks files inside)", async () => {
      // Pattern **/bamboo-specs/** blocks files inside, not the directory itself
      expect(callHook(hook, "grep", { path: "foo/bamboo-specs" }))
        .resolves.toBeUndefined()
    })

    test("defaults to . when path not provided", async () => {
      expect(callHook(hook, "grep", {})).resolves.toBeUndefined()
    })
  })

  describe("list tool", () => {
    test("allows list on project root", async () => {
      expect(callHook(hook, "list", { path: "." })).resolves.toBeUndefined()
    })

    test("allows list on allowed directories", async () => {
      expect(callHook(hook, "list", { path: "src" })).resolves.toBeUndefined()
    })

    test("blocks list on /to/ignore", async () => {
      expect(callHook(hook, "list", { path: "to/ignore" }))
        .rejects.toThrow(/Access denied.*to\/ignore/)
    })

    test("defaults to . when path not provided", async () => {
      expect(callHook(hook, "list", {})).resolves.toBeUndefined()
    })
  })
})

describe("Pattern Types", () => {
  let plugin: any
  let hook: any

  beforeAll(async () => {
    plugin = await createPlugin()
    hook = plugin["tool.execute.before"]
  })

  describe("absolute patterns", () => {
    test("blocks /to/ignore files", async () => {
      expect(callHook(hook, "read", { filePath: "to/ignore/file.txt" }))
        .rejects.toThrow(/Access denied/)
    })

    test("blocks /somedir/toignore/** files", async () => {
      expect(callHook(hook, "read", { filePath: "somedir/toignore/nested/file.txt" }))
        .rejects.toThrow(/Access denied/)
    })
  })

  describe("glob patterns", () => {
    test("blocks **/bamboo-specs/** files", async () => {
      expect(callHook(hook, "read", { filePath: "foo/bamboo-specs/plan.yml" }))
        .rejects.toThrow(/Access denied/)
      expect(callHook(hook, "read", { filePath: "bar/baz/bamboo-specs/config.xml" }))
        .rejects.toThrow(/Access denied/)
    })

    test("allows bamboo-specs directory itself (only blocks files inside)", async () => {
      // Note: Pattern **/bamboo-specs/** blocks files inside, not the dir itself
      expect(callHook(hook, "list", { path: "bamboo-specs" })).resolves.toBeUndefined()
    })

    test("blocks **/keycloak-realm-config/templates/** files", async () => {
      expect(callHook(hook, "read", { filePath: "keycloak-realm-config/templates/realm.json" }))
        .rejects.toThrow(/Access denied/)
    })
  })

  describe("wildcard patterns", () => {
    test("blocks *-realm.json files", async () => {
      expect(callHook(hook, "read", { filePath: "dev-realm.json" }))
        .rejects.toThrow(/Access denied/)
      expect(callHook(hook, "read", { filePath: "prod-realm.json" }))
        .rejects.toThrow(/Access denied/)
    })

    test("blocks some*.properties files", async () => {
      expect(callHook(hook, "read", { filePath: "some.properties" }))
        .rejects.toThrow(/Access denied/)
      expect(callHook(hook, "read", { filePath: "something.properties" }))
        .rejects.toThrow(/Access denied/)
    })

    test("allows other .properties files", async () => {
      // application.properties is also matched by app*.properties pattern
      // Use a file that definitely doesn't match: sample.properties in test-data
      expect(callHook(hook, "read", { filePath: "test-data/sample.properties" })).resolves.toBeUndefined()
    })
  })

  describe("negation patterns", () => {
    test("allows *.local.json despite blocking patterns", async () => {
      expect(callHook(hook, "read", { filePath: "config.local.json" })).resolves.toBeUndefined()
      expect(callHook(hook, "read", { filePath: "settings.local.jsonc" })).resolves.toBeUndefined()
    })

    test("allows *.local.md files", async () => {
      expect(callHook(hook, "read", { filePath: "notes.local.md" })).resolves.toBeUndefined()
    })

    test("allows /.local/ directory", async () => {
      expect(callHook(hook, "list", { path: ".local" })).resolves.toBeUndefined()
      expect(callHook(hook, "read", { filePath: ".local/impl.md" })).resolves.toBeUndefined()
    })

    test("blocks /somedir/toignore/** but allows file-to-not-ignore.md", async () => {
      expect(callHook(hook, "read", { filePath: "somedir/toignore/file-to-not-ignore.md" }))
        .resolves.toBeUndefined()
      expect(callHook(hook, "read", { filePath: "somedir/toignore/other-file.txt" }))
        .rejects.toThrow(/Access denied/)
    })

    test("allows **/target/** due to negation", async () => {
      expect(callHook(hook, "read", { filePath: "target/output.jar" })).resolves.toBeUndefined()
      expect(callHook(hook, "list", { path: "target" })).resolves.toBeUndefined()
    })
  })
})

describe("Path Normalization", () => {
  let plugin: any
  let hook: any

  beforeAll(async () => {
    plugin = await createPlugin()
    hook = plugin["tool.execute.before"]
  })

  describe("absolute paths", () => {
    test("handles absolute paths correctly", async () => {
      const absolutePath = path.join(TEST_PROJECT_ROOT, "secrets.json")
      expect(callHook(hook, "read", { filePath: absolutePath }))
        .rejects.toThrow(/Access denied/)
    })

    test("allows absolute path to allowed file", async () => {
      const absolutePath = path.join(TEST_PROJECT_ROOT, "README.md")
      expect(callHook(hook, "read", { filePath: absolutePath })).resolves.toBeUndefined()
    })
  })

  describe("./ prefix handling", () => {
    test("handles ./ prefix correctly", async () => {
      expect(callHook(hook, "read", { filePath: "./secrets.json" }))
        .rejects.toThrow(/Access denied/)
      expect(callHook(hook, "read", { filePath: "./index.ts" })).resolves.toBeUndefined()
    })
  })

  describe("nested directories", () => {
    test("handles deeply nested paths", async () => {
      expect(callHook(hook, "read", { filePath: "foo/bar/baz/bamboo-specs/plan.yml" }))
        .rejects.toThrow(/Access denied/)
      expect(callHook(hook, "read", { filePath: "deep/nested/path/allowed.txt" }))
        .resolves.toBeUndefined()
    })
  })

  describe("directory vs file matching", () => {
    test("directories get trailing slash for matching", async () => {
      // bamboo-specs/ as directory should be allowed (only files inside blocked)
      expect(callHook(hook, "list", { path: "bamboo-specs" })).resolves.toBeUndefined()
      
      // Files inside bamboo-specs/ should be blocked
      expect(callHook(hook, "read", { filePath: "bamboo-specs/file.txt" }))
        .rejects.toThrow(/Access denied/)
    })

    test(".local/ directory is allowed", async () => {
      expect(callHook(hook, "list", { path: ".local" })).resolves.toBeUndefined()
      expect(callHook(hook, "grep", { path: ".local" })).resolves.toBeUndefined()
    })
  })
})

describe("Edge Cases", () => {
  let plugin: any
  let hook: any

  beforeAll(async () => {
    plugin = await createPlugin()
    hook = plugin["tool.execute.before"]
  })

  test("handles undefined path gracefully", async () => {
    // Tools like glob/grep default to "." when no path provided
    expect(callHook(hook, "glob", {})).resolves.toBeUndefined()
    expect(callHook(hook, "grep", {})).resolves.toBeUndefined()
  })

  test("handles null/missing filePath for file tools", async () => {
    // Should not throw, just skip (no path to check)
    expect(callHook(hook, "read", {})).resolves.toBeUndefined()
  })

  test("handles empty string path", async () => {
    // Empty string should be treated as current dir
    expect(callHook(hook, "list", { path: "" })).resolves.toBeUndefined()
  })

  test("ignores unsupported tools", async () => {
    // Tool that's not in extractPathFromTool should be skipped
    expect(callHook(hook, "unknown_tool", { somePath: "secrets.json" }))
      .resolves.toBeUndefined()
  })

  test("error message includes blocked path", async () => {
    try {
      await callHook(hook, "read", { filePath: "secrets.json" })
      expect(false).toBe(true) // Should not reach here
    } catch (e: any) {
      expect(e.message).toContain("secrets.json")
      expect(e.message).toContain("blocked by ignore file")
      expect(e.message).toContain("Access denied")
    }
  })
})

describe("Real-world Scenarios", () => {
  let plugin: any
  let hook: any

  beforeAll(async () => {
    plugin = await createPlugin()
    hook = plugin["tool.execute.before"]
  })

  test("allows normal development workflow", async () => {
    // Reading source files
    expect(callHook(hook, "read", { filePath: "index.ts" })).resolves.toBeUndefined()
    expect(callHook(hook, "read", { filePath: "README.md" })).resolves.toBeUndefined()
    
    // Writing output
    expect(callHook(hook, "write", { filePath: "output.txt" })).resolves.toBeUndefined()
    
    // Searching codebase
    expect(callHook(hook, "grep", { path: "src" })).resolves.toBeUndefined()
    expect(callHook(hook, "glob", { path: "." })).resolves.toBeUndefined()
  })

  test("blocks sensitive files consistently", async () => {
    const sensitiveFiles = [
      "secrets.json",
      "credentials.json",
      ".env",
      ".env.production",
      "server.crt",
      "private.key",
      "id_rsa"
    ]

    for (const file of sensitiveFiles) {
      expect(callHook(hook, "read", { filePath: file }))
        .rejects.toThrow(/Access denied/)
    }
  })

  test("handles complex project structure", async () => {
    // Should allow src directory
    expect(callHook(hook, "list", { path: "src" })).resolves.toBeUndefined()
    
    // But block bamboo-specs inside any directory
    expect(callHook(hook, "read", { filePath: "src/bamboo-specs/plan.yml" }))
      .rejects.toThrow(/Access denied/)
  })
})

describe("Bash Tool Protection", () => {
  let plugin: any
  let hook: any

  beforeAll(async () => {
    plugin = await createPlugin()
    hook = plugin["tool.execute.before"]
  })

  describe("blocks sensitive files referenced in bash commands", () => {
    test("blocks 'cat secrets.json'", async () => {
      expect(callHook(hook, "bash", { command: "cat secrets.json" }))
        .rejects.toThrow(/Access denied.*secrets\.json/)
    })

    test("blocks 'head .env'", async () => {
      expect(callHook(hook, "bash", { command: "head .env" }))
        .rejects.toThrow(/Access denied.*\.env/)
    })

    test("blocks 'tail -n 10 credentials.json'", async () => {
      expect(callHook(hook, "bash", { command: "tail -n 10 credentials.json" }))
        .rejects.toThrow(/Access denied.*credentials\.json/)
    })

    test("blocks 'less private.key'", async () => {
      expect(callHook(hook, "bash", { command: "less private.key" }))
        .rejects.toThrow(/Access denied.*private\.key/)
    })

    test("blocks 'wc -l secrets.json'", async () => {
      expect(callHook(hook, "bash", { command: "wc -l secrets.json" }))
        .rejects.toThrow(/Access denied.*secrets\.json/)
    })
  })

  describe("handles quoted paths correctly", () => {
    test("blocks double-quoted path: cat \"secrets.json\"", async () => {
      expect(callHook(hook, "bash", { command: 'cat "secrets.json"' }))
        .rejects.toThrow(/Access denied.*secrets\.json/)
    })

    test("blocks single-quoted path: cat 'secrets.json'", async () => {
      expect(callHook(hook, "bash", { command: "cat 'secrets.json'" }))
        .rejects.toThrow(/Access denied.*secrets\.json/)
    })

    test("blocks double-quoted .env: cat \".env\"", async () => {
      expect(callHook(hook, "bash", { command: 'cat ".env"' }))
        .rejects.toThrow(/Access denied.*\.env/)
    })
  })

  describe("handles multi-command pipelines and operators", () => {
    test("blocks secrets.json before pipe: cat secrets.json | grep foo", async () => {
      expect(callHook(hook, "bash", { command: "cat secrets.json | grep foo" }))
        .rejects.toThrow(/Access denied.*secrets\.json/)
    })

    test("blocks secrets.json after &&: ls src && cat secrets.json", async () => {
      expect(callHook(hook, "bash", { command: "ls src && cat secrets.json" }))
        .rejects.toThrow(/Access denied.*secrets\.json/)
    })

    test("blocks .env in redirect: cat .env > /tmp/out.txt", async () => {
      expect(callHook(hook, "bash", { command: "cat .env > /tmp/out.txt" }))
        .rejects.toThrow(/Access denied.*\.env/)
    })

    test("blocks .env in semicolon chain: echo hello; cat .env", async () => {
      expect(callHook(hook, "bash", { command: "echo hello; cat .env" }))
        .rejects.toThrow(/Access denied.*\.env/)
    })
  })

  describe("allows safe bash commands", () => {
    test("allows 'cat index.ts'", async () => {
      expect(callHook(hook, "bash", { command: "cat index.ts" }))
        .resolves.toBeUndefined()
    })

    test("allows 'ls src'", async () => {
      expect(callHook(hook, "bash", { command: "ls src" }))
        .resolves.toBeUndefined()
    })

    test("allows 'echo hello'", async () => {
      expect(callHook(hook, "bash", { command: "echo hello" }))
        .resolves.toBeUndefined()
    })

    test("allows 'git status'", async () => {
      expect(callHook(hook, "bash", { command: "git status" }))
        .resolves.toBeUndefined()
    })

    test("allows 'npm install'", async () => {
      expect(callHook(hook, "bash", { command: "npm install" }))
        .resolves.toBeUndefined()
    })

    test("allows 'cat README.md'", async () => {
      expect(callHook(hook, "bash", { command: "cat README.md" }))
        .resolves.toBeUndefined()
    })
  })

  describe("edge cases", () => {
    test("graceful degradation: missing .ignore allows all bash commands", async () => {
      const tempDir = "/tmp/test-bash-no-ignore-" + Date.now()
      const tempPlugin = await createPlugin(tempDir)
      const tempHook = tempPlugin["tool.execute.before"]!
      expect(callHook(tempHook, "bash", { command: "cat secrets.json" }))
        .resolves.toBeUndefined()
    })

    test("handles empty command string gracefully", async () => {
      expect(callHook(hook, "bash", { command: "" }))
        .resolves.toBeUndefined()
    })

    test("handles missing command arg gracefully", async () => {
      expect(callHook(hook, "bash", {}))
        .resolves.toBeUndefined()
    })

    test("command name alone (no args) is allowed", async () => {
      expect(callHook(hook, "bash", { command: "secrets.json" }))
        .resolves.toBeUndefined()
    })

    test("flag-only command is allowed: grep -r pattern", async () => {
      expect(callHook(hook, "bash", { command: "grep -r pattern" }))
        .resolves.toBeUndefined()
    })
  })

  describe("Git Command Interception", () => {
    test("blocks git show with sensitive file via HEAD:<path>", async () => {
      expect(callHook(hook, "bash", { command: "git show HEAD:secrets.json" }))
        .rejects.toThrow(/Access denied.*secrets\.json/)
    })

    test("blocks git show with sensitive file via <sha>:<path>", async () => {
      expect(callHook(hook, "bash", { command: "git show abc1234:credentials.json" }))
        .rejects.toThrow(/Access denied.*credentials\.json/)
    })

    test("blocks git show with sensitive file via :<path> (index)", async () => {
      expect(callHook(hook, "bash", { command: "git show :.env" }))
        .rejects.toThrow(/Access denied.*\.env/)
    })

    test("allows git show with allowed file via HEAD:<path>", async () => {
      expect(callHook(hook, "bash", { command: "git show HEAD:README.md" }))
        .resolves.toBeUndefined()
    })

    test("blocks git cat-file entirely when .ignore exists", async () => {
      // Any cat-file is blocked regardless of path/sha
      expect(callHook(hook, "bash", { command: "git cat-file -p abc1234" }))
        .rejects.toThrow(/Access denied: git cat-file is blocked/)
      expect(callHook(hook, "bash", { command: "git cat-file blob HEAD:README.md" }))
        .rejects.toThrow(/Access denied: git cat-file is blocked/)
    })

    test("blocks git log -p -- <path> with sensitive file", async () => {
      expect(callHook(hook, "bash", { command: "git log -p -- secrets.json" }))
        .rejects.toThrow(/Access denied.*secrets\.json/)
    })

    test("allows git log -p -- <path> with allowed file", async () => {
      expect(callHook(hook, "bash", { command: "git log -p -- README.md" }))
        .resolves.toBeUndefined()
    })

    test("blocks git diff -- <path> with sensitive file", async () => {
      expect(callHook(hook, "bash", { command: "git diff HEAD~1 HEAD -- credentials.json" }))
        .rejects.toThrow(/Access denied.*credentials\.json/)
    })

    test("blocks git grep with sensitive file after --", async () => {
      expect(callHook(hook, "bash", { command: "git grep password HEAD -- secrets.json" }))
        .rejects.toThrow(/Access denied.*secrets\.json/)
    })

    test("blocks git blame with sensitive file", async () => {
      expect(callHook(hook, "bash", { command: "git blame secrets.json" }))
        .rejects.toThrow(/Access denied.*secrets\.json/)
      // Also with --
      expect(callHook(hook, "bash", { command: "git blame -- credentials.json" }))
        .rejects.toThrow(/Access denied.*credentials\.json/)
    })

    test("blocks git archive with sensitive file", async () => {
      expect(callHook(hook, "bash", { command: "git archive HEAD secrets.json" }))
        .rejects.toThrow(/Access denied.*secrets\.json/)
    })

    test("blocks pipelines starting with blocked git command", async () => {
      expect(callHook(hook, "bash", { command: "git show HEAD:secrets.json | grep foo" }))
        .rejects.toThrow(/Access denied.*secrets\.json/)
    })

    test("graceful degradation: missing .ignore allows git cat-file", async () => {
      const tempDir = "/tmp/test-git-no-ignore-" + Date.now()
      const tempPlugin = await createPlugin(tempDir)
      const tempHook = tempPlugin["tool.execute.before"]!
      expect(callHook(tempHook, "bash", { command: "git cat-file -p abc1234" }))
        .resolves.toBeUndefined()
    })

    test("blocks git cat-file -t regardless of path", async () => {
      expect(callHook(hook, "bash", { command: "git cat-file -t HEAD:README.md" }))
        .rejects.toThrow(/Access denied: git cat-file is blocked/)
    })

    test("blocks git log --follow -p -- .env", async () => {
      expect(callHook(hook, "bash", { command: "git log --follow -p -- .env" }))
        .rejects.toThrow(/Access denied.*\.env/)
    })

    test("allows git grep with allowed file after --", async () => {
      expect(callHook(hook, "bash", { command: "git grep export HEAD -- index.ts" }))
        .resolves.toBeUndefined()
    })

    test("allows pipeline starting with git show of allowed file", async () => {
      expect(callHook(hook, "bash", { command: "git show HEAD:index.ts | grep export" }))
        .resolves.toBeUndefined()
    })

    test("graceful degradation: missing .ignore allows git show of sensitive file", async () => {
      const tempDir = "/tmp/test-git-show-no-ignore-" + Date.now()
      const tempPlugin = await createPlugin(tempDir)
      const tempHook = tempPlugin["tool.execute.before"]!
      expect(callHook(tempHook, "bash", { command: "git show HEAD:secrets.json" }))
        .resolves.toBeUndefined()
    })
  })
})

describe("Glob Tool Result Filtering", () => {
  let plugin: any
  let afterHook: any

  beforeAll(async () => {
    plugin = await createPlugin()
    afterHook = plugin["tool.execute.after"]
  })

  test("filters blocked files from glob results", async () => {
    const mockOutput = {
      files: [
        "index.ts",              // ALLOWED
        "secrets.json",          // BLOCKED
        "credentials.json",      // BLOCKED
        "README.md",             // ALLOWED
        ".env",                  // BLOCKED
        "config.local.json"      // ALLOWED (negation)
      ]
    }

    const filtered = await afterHook(
      { tool: "glob", sessionID: "test", callID: "test" },
      { args: { pattern: "**/*" }, output: mockOutput }
    )

    expect(filtered.files).toHaveLength(3)
    expect(filtered.files).toContain("index.ts")
    expect(filtered.files).toContain("README.md")
    expect(filtered.files).toContain("config.local.json")
    expect(filtered.files).not.toContain("secrets.json")
    expect(filtered.files).not.toContain("credentials.json")
    expect(filtered.files).not.toContain(".env")
  })

  test("filters certificate and key files", async () => {
    const mockOutput = {
      files: [
        "server.crt",
        "private.key",
        "ca.pem",
        "README.md"
      ]
    }

    const filtered = await afterHook(
      { tool: "glob", sessionID: "test", callID: "test" },
      { args: { pattern: "**/*" }, output: mockOutput }
    )

    expect(filtered.files).toHaveLength(1)
    expect(filtered.files).toContain("README.md")
  })

  test("returns empty array when all files blocked", async () => {
    const mockOutput = {
      files: [
        "secrets.json",
        "credentials.json",
        ".env",
        "private.key"
      ]
    }

    const filtered = await afterHook(
      { tool: "glob", sessionID: "test", callID: "test" },
      { args: { pattern: "**/*" }, output: mockOutput }
    )

    expect(filtered.files).toHaveLength(0)
    expect(filtered.files).toEqual([])
  })

  test("handles glob results with no files", async () => {
    const mockOutput = { files: [] }

    const filtered = await afterHook(
      { tool: "glob", sessionID: "test", callID: "test" },
      { args: { pattern: "**/*.xyz" }, output: mockOutput }
    )

    expect(filtered.files).toEqual([])
  })

  test("handles malformed glob results gracefully", async () => {
    const mockOutput = { files: null }

    const filtered = await afterHook(
      { tool: "glob", sessionID: "test", callID: "test" },
      { args: { pattern: "**/*" }, output: mockOutput }
    )

    expect(filtered).toEqual(mockOutput)
  })

  test("respects negation patterns", async () => {
    const mockOutput = {
      files: [
        "config.local.json",      // ALLOWED (negation)
        "settings.local.jsonc",   // ALLOWED (negation)
        ".local/impl.md",         // ALLOWED (negation)
        "secrets.json"            // BLOCKED
      ]
    }

    const filtered = await afterHook(
      { tool: "glob", sessionID: "test", callID: "test" },
      { args: { pattern: "**/*" }, output: mockOutput }
    )

    expect(filtered.files).toHaveLength(3)
    expect(filtered.files).toContain("config.local.json")
    expect(filtered.files).toContain("settings.local.jsonc")
    expect(filtered.files).toContain(".local/impl.md")
  })

  test("does not filter non-glob tools", async () => {
    const mockOutput = {
      files: ["secrets.json", "index.ts"]
    }

    const filtered = await afterHook(
      { tool: "read", sessionID: "test", callID: "test" },
      { args: {}, output: mockOutput }
    )

    // Should return unchanged for non-glob tools
    expect(filtered).toEqual(mockOutput)
  })
})

describe("Grep Tool Result Filtering", () => {
  let plugin: any
  let afterHook: any

  beforeAll(async () => {
    plugin = await createPlugin()
    afterHook = plugin["tool.execute.after"]
  })

  test("filters blocked files from grep results", async () => {
    const mockOutput = {
      matches: [
        { file: "index.ts", line: 10, column: 5, match: "export" },           // ALLOWED
        { file: "secrets.json", line: 3, column: 10, match: "password" },     // BLOCKED
        { file: "README.md", line: 1, column: 0, match: "# opencode" },       // ALLOWED
        { file: ".env", line: 5, column: 0, match: "API_KEY=secret" }         // BLOCKED
      ]
    }

    const filtered = await afterHook(
      { tool: "grep", sessionID: "test", callID: "test" },
      { args: { pattern: ".*" }, output: mockOutput }
    )

    expect(filtered.matches).toHaveLength(2)
    expect(filtered.matches[0].file).toBe("index.ts")
    expect(filtered.matches[1].file).toBe("README.md")
  })

  test("does not leak any info about blocked files", async () => {
    const mockOutput = {
      matches: [
        { file: "credentials.json", line: 7, column: 15, match: "admin_password: secret123" },
        { file: "private.key", line: 1, column: 0, match: "-----BEGIN PRIVATE KEY-----" },
        { file: "index.ts", line: 50, column: 10, match: "const config" }
      ]
    }

    const filtered = await afterHook(
      { tool: "grep", sessionID: "test", callID: "test" },
      { args: { pattern: ".*" }, output: mockOutput }
    )

    // Only allowed file should remain
    expect(filtered.matches).toHaveLength(1)
    expect(filtered.matches[0].file).toBe("index.ts")
    
    // Ensure no info from blocked files leaks
    const resultStr = JSON.stringify(filtered)
    expect(resultStr).not.toContain("credentials.json")
    expect(resultStr).not.toContain("private.key")
    expect(resultStr).not.toContain("secret123")
    expect(resultStr).not.toContain("PRIVATE KEY")
  })

  test("returns empty matches when all blocked", async () => {
    const mockOutput = {
      matches: [
        { file: "secrets.json", line: 1, match: "secret" },
        { file: ".env", line: 2, match: "password" },
        { file: "private.key", line: 5, match: "key data" }
      ]
    }

    const filtered = await afterHook(
      { tool: "grep", sessionID: "test", callID: "test" },
      { args: { pattern: "secret" }, output: mockOutput }
    )

    expect(filtered.matches).toHaveLength(0)
    expect(filtered.matches).toEqual([])
  })

  test("handles grep results with no matches", async () => {
    const mockOutput = { matches: [] }

    const filtered = await afterHook(
      { tool: "grep", sessionID: "test", callID: "test" },
      { args: { pattern: "nonexistent" }, output: mockOutput }
    )

    expect(filtered.matches).toEqual([])
  })

  test("handles malformed grep results gracefully", async () => {
    const mockOutput = { matches: null }

    const filtered = await afterHook(
      { tool: "grep", sessionID: "test", callID: "test" },
      { args: { pattern: "test" }, output: mockOutput }
    )

    expect(filtered).toEqual(mockOutput)
  })

  test("keeps matches without file info", async () => {
    const mockOutput = {
      matches: [
        { file: "index.ts", line: 10, match: "export" },
        { line: 5, match: "some match without file" },  // No file property
        { file: "secrets.json", line: 3, match: "password" }
      ]
    }

    const filtered = await afterHook(
      { tool: "grep", sessionID: "test", callID: "test" },
      { args: { pattern: ".*" }, output: mockOutput }
    )

    expect(filtered.matches).toHaveLength(2)
    expect(filtered.matches[0].file).toBe("index.ts")
    expect(filtered.matches[1]).not.toHaveProperty("file")
  })

  test("respects negation patterns in grep", async () => {
    const mockOutput = {
      matches: [
        { file: "config.local.json", line: 1, match: "config" },    // ALLOWED (negation)
        { file: ".local/notes.md", line: 5, match: "notes" },       // ALLOWED (negation)
        { file: "secrets.json", line: 2, match: "secret" }          // BLOCKED
      ]
    }

    const filtered = await afterHook(
      { tool: "grep", sessionID: "test", callID: "test" },
      { args: { pattern: ".*" }, output: mockOutput }
    )

    expect(filtered.matches).toHaveLength(2)
    expect(filtered.matches[0].file).toBe("config.local.json")
    expect(filtered.matches[1].file).toBe(".local/notes.md")
  })

  test("does not filter non-grep tools", async () => {
    const mockOutput = {
      matches: [{ file: "secrets.json", line: 1, match: "secret" }]
    }

    const filtered = await afterHook(
      { tool: "write", sessionID: "test", callID: "test" },
      { args: {}, output: mockOutput }
    )

    // Should return unchanged for non-grep tools
    expect(filtered).toEqual(mockOutput)
  })
})
