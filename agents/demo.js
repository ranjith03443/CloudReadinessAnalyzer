// Demo pipeline — runs WITHOUT an OpenAI API key.
//
// It mirrors the real LangGraph pipeline's streaming behaviour (the same
// `{ type: "stage", ... }` events, in the same order, with realistic delays)
// but returns a fixed, pre-computed analysis for the bundled sample legacy
// .NET file. This lets anyone see the multi-agent flow end-to-end before
// wiring up their own key. The real analysis lives in ./pipeline.js.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DOTNET_DEMO_RESULT = {
  summary: {
    fileName: "LegacyOrderService.cs",
    overview:
      "This legacy .NET Framework service carries several cloud-migration blockers: " +
      "synchronous System.Web dependencies, configuration read directly from " +
      "Web.config / ConfigurationManager, and a hardcoded SQL connection string. " +
      "Externalizing configuration and moving to ASP.NET Core makes it container- and cloud-ready.",
  },
  findings: [
    {
      id: "dn1",
      title: "ConfigurationManager.AppSettings used for runtime config",
      severity: "High",
      category: "Hardcoded Config",
      location: "GetConnection(), line ~22",
      explanation:
        "Configuration is read from Web.config via ConfigurationManager. In a cloud " +
        "environment config should come from environment variables or a secret store so " +
        "the same image can be promoted across environments without a rebuild.",
      recommendation:
        "Bind settings through IConfiguration / IOptions<T> and source them from " +
        "environment variables (e.g. Azure App Configuration or AWS Parameter Store).",
    },
    {
      id: "dn2",
      title: "Hardcoded SQL Server connection string with credentials",
      severity: "High",
      category: "Hardcoded Config",
      location: "Web.config <connectionStrings>",
      explanation:
        "The connection string embeds a server host and SQL credentials. This leaks secrets " +
        "into source control and pins the app to a single database host.",
      recommendation:
        "Move the connection string to a secret manager and inject it at runtime. Prefer " +
        "managed identity / IAM auth over username + password where available.",
    },
    {
      id: "dn3",
      title: "System.Web / HttpContext.Current dependency",
      severity: "High",
      category: "Cloud Incompatibility",
      location: "LogRequest(), line ~41",
      explanation:
        "HttpContext.Current relies on the legacy System.Web pipeline, which does not exist in " +
        "ASP.NET Core and prevents running on Linux containers or serverless hosts.",
      recommendation:
        "Replace with IHttpContextAccessor injected via DI, or pass the required values " +
        "explicitly so the service has no ambient static state.",
    },
    {
      id: "dn4",
      title: "Synchronous blocking database calls",
      severity: "Medium",
      category: "Cloud Incompatibility",
      location: "GetOrders(), line ~30",
      explanation:
        "ExecuteReader() blocks the calling thread. Under cloud autoscaling this wastes thread-pool " +
        "capacity and reduces throughput per instance, increasing cost.",
      recommendation:
        "Switch to async ADO.NET (ExecuteReaderAsync) or an async-first ORM and await calls end-to-end.",
    },
    {
      id: "dn5",
      title: "Local file-system logging to a fixed path",
      severity: "Medium",
      category: "Cloud Incompatibility",
      location: "LogRequest(), line ~44",
      explanation:
        "Writing logs to C:\\logs assumes a persistent local disk. Container file systems are " +
        "ephemeral and the Windows path will not exist on Linux hosts.",
      recommendation:
        "Emit structured logs to stdout/stderr and let the platform collect them (e.g. via the " +
        "console logger), or ship to a centralized log service.",
    },
    {
      id: "dn6",
      title: "BinaryFormatter used for caching",
      severity: "Low",
      category: "Deprecated API",
      location: "CacheOrder(), line ~52",
      explanation:
        "BinaryFormatter is obsolete and disabled by default in modern .NET due to known " +
        "deserialization vulnerabilities.",
      recommendation:
        "Serialize with System.Text.Json (or a distributed cache like Redis) instead of BinaryFormatter.",
    },
  ],
  modernizedCode: `// LegacyOrderService.cs — modernized for ASP.NET Core / cloud
using System.Data.Common;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

public sealed class OrderServiceOptions
{
    public string ConnectionString { get; set; } = string.Empty;
}

public sealed class OrderService
{
    private readonly OrderServiceOptions _options;
    private readonly ILogger<OrderService> _logger;

    // Config + logging are injected — no static state, no Web.config.
    public OrderService(IOptions<OrderServiceOptions> options, ILogger<OrderService> logger)
    {
        _options = options.Value;
        _logger = logger;
    }

    public async Task<IReadOnlyList<Order>> GetOrdersAsync(int customerId, CancellationToken ct)
    {
        var orders = new List<Order>();

        await using var connection = new SqlConnection(_options.ConnectionString);
        await connection.OpenAsync(ct);

        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, Total FROM Orders WHERE CustomerId = @customerId";
        command.Parameters.Add(new SqlParameter("@customerId", customerId));

        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            orders.Add(new Order(reader.GetInt32(0), reader.GetDecimal(1)));
        }

        // Structured logging to stdout — collected by the platform.
        _logger.LogInformation("Fetched {Count} orders for customer {CustomerId}", orders.Count, customerId);
        return orders;
    }
}

public readonly record struct Order(int Id, decimal Total);`,
  cloudReadyConfig: `# appsettings.json values are overridden by environment variables in the cloud.
# Nothing secret is committed — secrets are injected at runtime.

# Bound to OrderServiceOptions:ConnectionString
OrderServiceOptions__ConnectionString="\${SQL_CONNECTION_STRING}"

# Logging goes to the console provider (stdout), collected by the platform.
Logging__LogLevel__Default="Information"
Logging__Console__FormatterName="json"

# Example Program.cs wiring (ASP.NET Core):
#   builder.Services.Configure<OrderServiceOptions>(
#       builder.Configuration.GetSection("OrderServiceOptions"));
#   builder.Services.AddScoped<OrderService>();
#   builder.Logging.AddJsonConsole();`,
  cloudReadinessScore: 38,
  scoreRationale:
    "Multiple high-severity blockers (System.Web coupling, hardcoded secrets, local disk logging) " +
    "must be resolved before this service can run reliably in containers or serverless. The business " +
    "logic itself migrates cleanly, so remediation is well-scoped rather than a rewrite.",
  scoreBreakdown: [
    { layer: "Configuration", score: 25, note: "Secrets & settings hardcoded in Web.config." },
    { layer: "Statelessness", score: 35, note: "HttpContext.Current + local file logging." },
    { layer: "API Compatibility", score: 50, note: "System.Web & BinaryFormatter need replacing." },
    { layer: "Scalability", score: 45, note: "Synchronous blocking DB calls limit throughput." },
  ],
  riskSummary: {
    level: "High",
    text:
      "Migration risk is HIGH but bounded. The three high-severity items (ambient HttpContext, " +
      "hardcoded credentials, and local-disk logging) each block containerization and must be " +
      "addressed first. None require redesigning the domain logic — they are mechanical refactors " +
      "to dependency injection, externalized config, and stdout logging. Estimated effort: 2–3 days.",
  },
  migrationEstimate: {
    effortDaysLow: 2,
    effortDaysHigh: 3,
    confidence: "Medium",
    rationale:
      "Well-scoped, mechanical refactors with no domain redesign. The range covers test " +
      "updates and verifying parity once config and logging move to the platform.",
    tasks: [
      { task: "Externalize config & secrets to IConfiguration / env vars", effortDays: 0.5 },
      { task: "Remove System.Web / HttpContext.Current via DI", effortDays: 1 },
      { task: "Convert blocking ADO.NET calls to async", effortDays: 0.5 },
      { task: "Switch local-disk logging to structured stdout", effortDays: 0.5 },
      { task: "Replace BinaryFormatter; update & run tests", effortDays: 0.5 },
    ],
  },
};

const JAVA_DEMO_RESULT = {
  summary: {
    fileName: "LegacyOrderService.java",
    overview:
      "This legacy Java 8 service has several cloud-migration blockers: a hardcoded JDBC " +
      "connection string with embedded credentials, file-system logging to a fixed path, " +
      "SQL built by string concatenation, and deprecated/legacy APIs (explicit JDBC driver " +
      "loading, Vector/Hashtable). Externalizing configuration and moving to a modern " +
      "framework (e.g. Spring Boot) makes it container- and cloud-ready.",
  },
  findings: [
    {
      id: "jv1",
      title: "Hardcoded JDBC URL with embedded credentials",
      severity: "High",
      category: "Hardcoded Config",
      location: "JDBC_URL constant, line ~17",
      explanation:
        "The JDBC URL embeds the database host plus a username and password directly in source. " +
        "This leaks secrets into version control and pins the app to a single database host, so " +
        "the same artifact cannot be promoted across environments.",
      recommendation:
        "Move the URL and credentials to environment variables or a secret manager (e.g. Spring " +
        "Boot externalized config, AWS Secrets Manager, or Vault). Prefer IAM/managed identity " +
        "auth over a static username + password where available.",
    },
    {
      id: "jv2",
      title: "SQL built via string concatenation (injection risk)",
      severity: "High",
      category: "Cloud Incompatibility",
      location: "getOrder(), line ~32",
      explanation:
        "The query is assembled by concatenating the orderId into the SQL string, which is a " +
        "SQL-injection vulnerability. Beyond security, ad-hoc JDBC like this is hard to pool and " +
        "scale reliably under cloud autoscaling.",
      recommendation:
        "Use a PreparedStatement with bound parameters, and access the database through a managed " +
        "connection pool (HikariCP / Spring Data) so connections scale cleanly per instance.",
    },
    {
      id: "jv3",
      title: "File-system logging to a fixed local path",
      severity: "High",
      category: "Cloud Incompatibility",
      location: "log(), line ~53",
      explanation:
        "Logs are written with FileWriter to /var/app/logs, assuming a persistent writable disk. " +
        "Container file systems are ephemeral, and the path may not exist or be writable on a " +
        "cloud host, so log data is lost on restart.",
      recommendation:
        "Use a logging framework (SLF4J + Logback) that writes structured logs to stdout, and let " +
        "the platform collect them, or ship to a centralized log service.",
    },
    {
      id: "jv4",
      title: "Explicit JDBC driver loading with Class.forName",
      severity: "Medium",
      category: "Deprecated API",
      location: "getOrder(), line ~27",
      explanation:
        "Class.forName(\"com.mysql.jdbc.Driver\") is unnecessary since JDBC 4.0 (auto-registration) " +
        "and the driver class name itself is deprecated in favor of com.mysql.cj.jdbc.Driver.",
      recommendation:
        "Remove the manual Class.forName call and rely on automatic driver registration via a " +
        "managed DataSource / connection pool.",
    },
    {
      id: "jv5",
      title: "Manual JDBC resource handling without try-with-resources",
      severity: "Medium",
      category: "Cloud Incompatibility",
      location: "getOrder(), line ~29",
      explanation:
        "Connection and Statement are closed manually; on an exception they leak, exhausting the " +
        "connection pool. Under autoscaling, leaked connections cascade into instance failures.",
      recommendation:
        "Wrap JDBC resources in try-with-resources, or use a higher-level abstraction " +
        "(Spring JdbcTemplate / JPA) that manages connection lifecycle for you.",
    },
    {
      id: "jv6",
      title: "Legacy synchronized collections (Vector / Hashtable)",
      severity: "Low",
      category: "Deprecated API",
      location: "getRecent(), getOrder()",
      explanation:
        "Vector and Hashtable are legacy synchronized collections retained only for backward " +
        "compatibility. Their implicit locking adds contention without benefit in modern code.",
      recommendation:
        "Use ArrayList / HashMap (or concurrent collections where thread-safety is actually " +
        "required) instead of Vector and Hashtable.",
    },
  ],
  modernizedCode: `// LegacyOrderService.java — modernized for Spring Boot / cloud
package com.contoso.orders;

import java.util.List;
import java.util.Map;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class OrderService {

    private static final Logger log = LoggerFactory.getLogger(OrderService.class);
    private final JdbcTemplate jdbc;

    // DataSource is injected (config + pooling come from Spring / environment),
    // so there are no hardcoded credentials and no manual driver loading.
    public OrderService(DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    public Map<String, Object> getOrder(int orderId) {
        // Parameterized query — no string concatenation, no SQL injection.
        Map<String, Object> order = jdbc.queryForMap(
                "SELECT id, customer, total FROM orders WHERE id = ?", orderId);

        // Structured logging to stdout, collected by the platform.
        log.info("Fetched order {}", orderId);
        return order;
    }

    public List<String> getRecent() {
        // Modern, unsynchronized collection via parameterized query.
        return jdbc.queryForList(
                "SELECT name FROM orders ORDER BY created_at DESC LIMIT 10", String.class);
    }
}`,
  cloudReadyConfig: `# application.yml — values come from the environment in the cloud.
# No secrets are committed; they are injected at runtime.

spring:
  datasource:
    # Resolved from environment variables / secret manager:
    url: \${SPRING_DATASOURCE_URL}
    username: \${SPRING_DATASOURCE_USERNAME}
    password: \${SPRING_DATASOURCE_PASSWORD}
    hikari:
      maximum-pool-size: 10

# Structured logs to stdout (collected by the platform); no local files.
logging:
  pattern:
    console: "%d{ISO8601} %-5level %logger{36} - %msg%n"
  level:
    root: INFO

payment:
  gateway:
    url: \${PAYMENT_GATEWAY_URL}`,
  cloudReadinessScore: 41,
  scoreRationale:
    "Several high-severity blockers (hardcoded JDBC credentials, string-concatenated SQL, and " +
    "local-disk logging) must be fixed before this service runs reliably in containers. The domain " +
    "logic is small and migrates cleanly to Spring Boot, so remediation is well-scoped.",
  scoreBreakdown: [
    { layer: "Configuration", score: 25, note: "JDBC URL & credentials hardcoded in source." },
    { layer: "Statelessness", score: 40, note: "File-system logging to a fixed local path." },
    { layer: "API Compatibility", score: 55, note: "Manual driver loading, Vector/Hashtable." },
    { layer: "Scalability", score: 45, note: "Unpooled JDBC + leak-prone resource handling." },
  ],
  riskSummary: {
    level: "High",
    text:
      "Migration risk is HIGH but bounded. The high-severity items (embedded credentials, " +
      "SQL injection via concatenation, and local-disk logging) each block safe containerization " +
      "and must be addressed first. None require redesigning the domain logic — they are " +
      "mechanical refactors to externalized config, parameterized queries, a connection pool, and " +
      "stdout logging. Estimated effort: 2–3 days.",
  },
  migrationEstimate: {
    effortDaysLow: 2,
    effortDaysHigh: 3,
    confidence: "Medium",
    rationale:
      "Small domain surface that ports cleanly to Spring Boot. The range covers parameterizing " +
      "queries, adding a connection pool, and verifying parity with updated tests.",
    tasks: [
      { task: "Externalize JDBC URL & credentials to env / config", effortDays: 0.5 },
      { task: "Parameterize SQL to remove injection risk", effortDays: 0.5 },
      { task: "Introduce a connection pool & fix resource handling", effortDays: 0.5 },
      { task: "Replace legacy APIs (driver load, Vector/Hashtable)", effortDays: 0.5 },
      { task: "Move logging to stdout; update & run tests", effortDays: 1 },
    ],
  },
};

// --- Phase 1 (assessment-only) demo fixtures ---------------------------------
//
// Reuses the findings/score/risk data above (still accurate for the bundled
// sample files) and layers on canned dependency + strategy + estimate data,
// so demo mode exercises the full 5-agent assessment graph and Gate A without
// needing an API key.

const DOTNET_ASSESSMENT_DEMO = {
  summary: DOTNET_DEMO_RESULT.summary,
  findings: DOTNET_DEMO_RESULT.findings,
  dependencySummary:
    "3 external dependencies found (System, System.Web, System.Data.SqlClient) — all standard " +
    ".NET Framework/BCL libraries with modern cross-platform equivalents. No internal cross-file " +
    "references were unresolved.",
  dependencies: [
    { reference: "System.Web", category: "external", risk: "High", note: "System.Web does not exist in modern ASP.NET Core — this is the primary migration blocker, not just a library swap." },
    { reference: "System.Data.SqlClient", category: "external", risk: "Low", note: "Superseded by Microsoft.Data.SqlClient; a straightforward package swap." },
    { reference: "System", category: "external", risk: "None", note: "Core BCL namespace, no migration impact." },
  ],
  externalDependencyCount: 3,
  internalDependencyCount: 0,
  recommendedStrategy: "Replatform",
  migrationType: "same-language",
  targetLanguage: null,
  targetArchitecture: "Azure App Service (Linux) + Azure SQL Database + Azure Key Vault",
  strategyJustification:
    "The blockers found (System.Web coupling, hardcoded secrets, local-disk logging) are all " +
    "mechanical — none require redesigning the domain logic. Modernizing to ASP.NET Core in place " +
    "and moving to a managed App Service is materially lower-risk than a full rewrite, and the " +
    "existing SQL Server schema maps directly onto Azure SQL.",
  cloudReadinessScore: DOTNET_DEMO_RESULT.cloudReadinessScore,
  scoreRationale: DOTNET_DEMO_RESULT.scoreRationale,
  scoreBreakdown: DOTNET_DEMO_RESULT.scoreBreakdown,
  riskSummary: DOTNET_DEMO_RESULT.riskSummary,
  migrationEstimate: DOTNET_DEMO_RESULT.migrationEstimate,
};

const JAVA_ASSESSMENT_DEMO = {
  summary: JAVA_DEMO_RESULT.summary,
  findings: JAVA_DEMO_RESULT.findings,
  dependencySummary:
    "2 external dependencies found (java.sql, java.util) — both standard JDK libraries. No " +
    "internal cross-file references were unresolved.",
  dependencies: [
    { reference: "java.sql", category: "external", risk: "Low", note: "Standard JDBC API; migrates cleanly to a managed connection pool (HikariCP/Spring Data)." },
    { reference: "java.util", category: "external", risk: "None", note: "Core JDK collections, no migration impact beyond replacing legacy Vector/Hashtable usage." },
  ],
  externalDependencyCount: 2,
  internalDependencyCount: 0,
  recommendedStrategy: "Replatform",
  migrationType: "same-language",
  targetLanguage: null,
  targetArchitecture: "AWS ECS Fargate + Amazon RDS (PostgreSQL) + AWS Secrets Manager",
  strategyJustification:
    "The blockers (hardcoded JDBC credentials, string-concatenated SQL, local-disk logging) are " +
    "mechanical fixes, not architectural ones — the domain logic is small and framework-light, so " +
    "porting to Spring Boot in the same language is lower-risk than a cross-tech rewrite and keeps " +
    "the team's existing Java expertise fully applicable.",
  cloudReadinessScore: JAVA_DEMO_RESULT.cloudReadinessScore,
  scoreRationale: JAVA_DEMO_RESULT.scoreRationale,
  scoreBreakdown: JAVA_DEMO_RESULT.scoreBreakdown,
  riskSummary: JAVA_DEMO_RESULT.riskSummary,
  migrationEstimate: JAVA_DEMO_RESULT.migrationEstimate,
};

function pickAssessmentDemoResult(ctx = {}) {
  const lang = String(ctx.language || "").toLowerCase();
  const name = String(ctx.fileName || "").toLowerCase();
  if (lang.includes("java") || name.endsWith(".java")) return JAVA_ASSESSMENT_DEMO;
  return DOTNET_ASSESSMENT_DEMO;
}

const ASSESSMENT_DEMO_USAGE = {
  detect: { promptTokens: 1842, completionTokens: 731, totalTokens: 2573 },
  dependency: { promptTokens: 980, completionTokens: 340, totalTokens: 1320 },
  strategize: { promptTokens: 2210, completionTokens: 512, totalTokens: 2722 },
  score: { promptTokens: 1903, completionTokens: 402, totalTokens: 2305 },
  estimate: { promptTokens: 1650, completionTokens: 380, totalTokens: 2030 },
};

// Mirrors runAssessmentPipeline(ctx, onEvent): emits the same 5 stage events,
// in the same fan-out/fan-in order as the real graph (detect+dependency
// parallel, then score+strategize, then estimate), then resolves with the
// canned result matching the requested platform. Templates the target
// architecture string on the caller's selected cloud/pattern so switching
// them in a live demo visibly changes the output.
export async function runDemoAssessment(ctx = {}, onEvent = () => {}) {
  const base = pickAssessmentDemoResult(ctx);
  const result = {
    ...base,
    ...applyMigrationPreference(base, ctx),
    targetArchitecture: templateTargetArchitecture(base.targetArchitecture, ctx),
  };
  const start = Date.now();
  const telemetry = { stages: [], promptTokens: 0, completionTokens: 0, totalTokens: 0, totalMs: 0 };
  const record = (stage, usage, ms) => {
    telemetry.stages.push({ stage, ...usage, ms });
    telemetry.promptTokens += usage.promptTokens;
    telemetry.completionTokens += usage.completionTokens;
    telemetry.totalTokens += usage.totalTokens;
  };

  onEvent({ type: "stage", stage: "detect", status: "start" });
  onEvent({ type: "stage", stage: "dependency", status: "start" });

  await sleep(1100);
  record("detect", ASSESSMENT_DEMO_USAGE.detect, 1100);
  onEvent({ type: "stage", stage: "detect", status: "done", count: result.findings.length, usage: ASSESSMENT_DEMO_USAGE.detect, ms: 1100 });

  await sleep(500);
  record("dependency", ASSESSMENT_DEMO_USAGE.dependency, 1600);
  onEvent({ type: "stage", stage: "dependency", status: "done", count: result.dependencies.length, usage: ASSESSMENT_DEMO_USAGE.dependency, ms: 1600 });

  onEvent({ type: "stage", stage: "score", status: "start" });
  onEvent({ type: "stage", stage: "strategize", status: "start" });

  await sleep(700);
  record("score", ASSESSMENT_DEMO_USAGE.score, 700);
  onEvent({ type: "stage", stage: "score", status: "done", usage: ASSESSMENT_DEMO_USAGE.score, ms: 700 });

  await sleep(500);
  record("strategize", ASSESSMENT_DEMO_USAGE.strategize, 1200);
  onEvent({ type: "stage", stage: "strategize", status: "done", usage: ASSESSMENT_DEMO_USAGE.strategize, ms: 1200 });

  onEvent({ type: "stage", stage: "estimate", status: "start" });
  await sleep(600);
  record("estimate", ASSESSMENT_DEMO_USAGE.estimate, 600);
  onEvent({ type: "stage", stage: "estimate", status: "done", usage: ASSESSMENT_DEMO_USAGE.estimate, ms: 600 });

  telemetry.totalMs = Date.now() - start;
  telemetry.provider = "demo";
  telemetry.model = "gpt-4o-mini (demo)";
  telemetry.estimatedCostUsd = demoCost(telemetry);

  return { ...result, telemetry };
}

// Honors a stated Migration Goal preference (Cloud Readiness / Cross-Tech /
// let AI decide) in demo mode, the same way the real Strategy Planner is
// instructed to: generally follow it, and say so in the justification,
// rather than ignoring it. Returns the fields to override, or {} if no
// preference was stated.
function applyMigrationPreference(base, ctx) {
  const { preferredMigrationType, preferredTargetLanguage, language } = ctx;
  if (!preferredMigrationType) return {};

  if (preferredMigrationType === "cross-tech") {
    const targetLanguage = preferredTargetLanguage && preferredTargetLanguage !== language ? preferredTargetLanguage : "Java";
    return {
      recommendedStrategy: "Refactor",
      migrationType: "cross-tech",
      targetLanguage,
      strategyJustification:
        `Following your stated goal of a cross-tech migration to ${targetLanguage}. Nothing in the findings makes this ` +
        `inadvisable, but note it carries materially more risk and effort than the same-language modernization this codebase ` +
        `would otherwise need — see the Estimation and Validation tabs for the confidence trade-off.`,
    };
  }

  // "same-language" preference: the canned demo results are already
  // same-language by default, just make the justification acknowledge it
  // was a stated goal, not an unprompted default.
  return {
    strategyJustification:
      `Following your stated goal of same-language cloud readiness modernization. ` + base.strategyJustification,
  };
}

// Swaps the canned recommendation's cloud/pattern wording for whatever the
// caller actually selected, so the demo visibly reacts to the Target
// Cloud / Target Architecture Pattern inputs instead of always saying Azure.
function templateTargetArchitecture(text, ctx) {
  const cloud = ctx.targetCloud;
  if (!cloud || text.startsWith(cloud) || text.toLowerCase().includes(cloud.toLowerCase())) return text;
  const byCloud = {
    Azure: "Azure App Service (Linux) + Azure SQL Database + Azure Key Vault",
    AWS: "AWS ECS Fargate + Amazon RDS + AWS Secrets Manager",
    GCP: "GCP Cloud Run + Cloud SQL + Secret Manager",
  };
  return byCloud[cloud] || text;
}

// Demo-mode reply for Gate A's "Discuss with AI" chat — no API key needed.
// Loosely reacts to a few common keywords so the chat still feels responsive
// in a live demo, without making any real model call.
export async function discussStrategyDemo({ userMessage, initialRecommendation } = {}) {
  await sleep(500);
  const msg = String(userMessage || "").toLowerCase();
  const rec = initialRecommendation || {};

  if (msg.includes("aws")) {
    return {
      reply:
        "Understood — targeting AWS instead. The findings here don't require a language change, so " +
        "the recommendation still holds as a same-language modernization; the target architecture " +
        "would move to AWS ECS Fargate + RDS + Secrets Manager.",
      suggestedMigrationType: "same-language",
      suggestedTargetLanguage: null,
      suggestedTargetArchitecturePattern: "Containers",
    };
  }
  if (msg.includes("gcp") || msg.includes("google")) {
    return {
      reply:
        "Got it — for GCP this still fits a same-language modernization; I'd target Cloud Run + " +
        "Cloud SQL + Secret Manager rather than a full rewrite.",
      suggestedMigrationType: "same-language",
      suggestedTargetLanguage: null,
      suggestedTargetArchitecturePattern: "Serverless",
    };
  }
  if (msg.includes("rewrite") || msg.includes("java") || msg.includes("different language") || msg.includes("cross-tech")) {
    return {
      reply:
        "A rewrite is possible, but I'd push back on it here: none of the findings require a " +
        "different language, they're all mechanical (config externalization, async I/O, structured " +
        "logging). A cross-tech rewrite would cost materially more effort for the same outcome — " +
        "I'd only recommend it if the team specifically wants to standardize on a different stack.",
      suggestedMigrationType: rec.migrationType || "same-language",
      suggestedTargetLanguage: null,
      suggestedTargetArchitecturePattern: null,
    };
  }
  return {
    reply:
      "Noted. Based on the findings and dependencies already gathered, I don't see anything that " +
      "changes the underlying recommendation — let me know a specific constraint (target cloud, " +
      "team skillset, timeline) and I'll factor it in.",
    suggestedMigrationType: rec.migrationType || "same-language",
    suggestedTargetLanguage: rec.targetLanguage || null,
    suggestedTargetArchitecturePattern: null,
  };
}

// --- Phase 2 (transformation) demo fixtures ----------------------------------
//
// Reuses the modernized code/config already written for the old single-pass
// demo (still accurate) for the two same-language cases, and adds one canned
// cross-tech (.NET -> Java) example so switching migration type in a live
// demo produces visibly different Transformation/Validation output.

function resolvedAll(findings, note) {
  return findings.map((f) => ({ findingId: f.id, resolved: true, note }));
}

const DOTNET_SAME_LANG_TRANSFORM_DEMO = {
  modernizedCode: DOTNET_DEMO_RESULT.modernizedCode,
  cloudReadyConfig: DOTNET_DEMO_RESULT.cloudReadyConfig,
  translationAssumptions: [],
  findingResolutions: resolvedAll(DOTNET_DEMO_RESULT.findings, "Addressed by the ASP.NET Core rewrite (DI, async I/O, externalized config)."),
  staticChecks: [
    { check: "Braces/blocks balanced", passed: true },
    { check: "No leftover hardcoded secrets", passed: true },
    { check: "No leftover TODO/FIXME markers", passed: true },
  ],
  structuralParity: null,
  manualReviewRecommended: false,
  validationSummary:
    "High confidence: all 6 findings are addressed by mechanical, well-understood refactors " +
    "(dependency injection, async I/O, structured logging, externalized config). No domain logic changed.",
};

const JAVA_SAME_LANG_TRANSFORM_DEMO = {
  modernizedCode: JAVA_DEMO_RESULT.modernizedCode,
  cloudReadyConfig: JAVA_DEMO_RESULT.cloudReadyConfig,
  translationAssumptions: [],
  findingResolutions: resolvedAll(JAVA_DEMO_RESULT.findings, "Addressed by the Spring Boot rewrite (connection pool, parameterized SQL, stdout logging)."),
  staticChecks: [
    { check: "Braces/blocks balanced", passed: true },
    { check: "No leftover hardcoded secrets", passed: true },
    { check: "No leftover TODO/FIXME markers", passed: true },
  ],
  structuralParity: null,
  manualReviewRecommended: false,
  validationSummary:
    "High confidence: all 6 findings are addressed by mechanical, well-understood refactors " +
    "(connection pooling, parameterized queries, stdout logging, externalized config). No domain logic changed.",
};

// A single canned cross-tech example, regardless of source language, so the
// UI has something concrete to show when Migration Type = Cross-Tech.
function crossTechTransformDemo(sourceFindings) {
  return {
    modernizedCode: JAVA_DEMO_RESULT.modernizedCode,
    cloudReadyConfig: JAVA_DEMO_RESULT.cloudReadyConfig,
    translationAssumptions: [
      "Assumed the original's synchronous request/response flow maps directly onto a Spring Boot @Service method — no async boundary was inferred.",
      "Assumed numeric precision (decimal/currency handling) is equivalent between the source type system and the target's BigDecimal usage; not independently verified.",
      "Assumed the original caching behavior (now removed) was not relied on for correctness elsewhere in the caller — flagged for manual confirmation.",
    ],
    findingResolutions: resolvedAll(sourceFindings, "Logic re-implemented in the target language; behavioral equivalence not independently verified — see translation assumptions."),
    staticChecks: [
      { check: "Braces/blocks balanced", passed: true },
      { check: "No leftover hardcoded secrets", passed: true },
      { check: "No leftover TODO/FIXME markers", passed: true },
      { check: "Method/function count within expected range of the original", passed: true },
    ],
    structuralParity: { originalDeclarationCount: sourceFindings.length ? 4 : 0, modernizedDeclarationCount: 3, withinExpectedRange: true },
    manualReviewRecommended: true,
    validationSummary:
      "Lower confidence than a same-language modernization: this is a full logic translation, so behavioral " +
      "equivalence cannot be verified deterministically. Manual review is strongly recommended before this " +
      "artifact is treated as production-ready — see the translation assumptions list.",
  };
}

function pickTransformDemoResult(ctx = {}) {
  if (ctx.migrationType === "cross-tech") {
    return crossTechTransformDemo(ctx.findings || []);
  }
  const lang = String(ctx.language || "").toLowerCase();
  if (lang.includes("java")) return JAVA_SAME_LANG_TRANSFORM_DEMO;
  return DOTNET_SAME_LANG_TRANSFORM_DEMO;
}

const TRANSFORM_DEMO_USAGE = {
  modernize: { promptTokens: 2156, completionTokens: 968, totalTokens: 3124 },
  validate: { promptTokens: 1780, completionTokens: 420, totalTokens: 2200 },
};

// Mirrors runTransformPipeline(ctx, onEvent): emits the same 2 stage events
// (modernize -> validate, strictly sequential since validate needs
// modernize's output), then resolves with a canned result — cross-tech vs.
// same-language, per ctx.migrationType.
export async function runDemoTransformation(ctx = {}, onEvent = () => {}) {
  const result = pickTransformDemoResult(ctx);
  const start = Date.now();
  const telemetry = { stages: [], promptTokens: 0, completionTokens: 0, totalTokens: 0, totalMs: 0 };
  const record = (stage, usage, ms) => {
    telemetry.stages.push({ stage, ...usage, ms });
    telemetry.promptTokens += usage.promptTokens;
    telemetry.completionTokens += usage.completionTokens;
    telemetry.totalTokens += usage.totalTokens;
  };

  onEvent({ type: "stage", stage: "modernize", status: "start" });
  await sleep(1000);
  record("modernize", TRANSFORM_DEMO_USAGE.modernize, 1000);
  onEvent({ type: "stage", stage: "modernize", status: "done", usage: TRANSFORM_DEMO_USAGE.modernize, ms: 1000 });

  onEvent({ type: "stage", stage: "validate", status: "start" });
  await sleep(800);
  record("validate", TRANSFORM_DEMO_USAGE.validate, 800);
  onEvent({ type: "stage", stage: "validate", status: "done", usage: TRANSFORM_DEMO_USAGE.validate, ms: 800 });

  telemetry.totalMs = Date.now() - start;
  telemetry.provider = "demo";
  telemetry.model = "gpt-4o-mini (demo)";
  telemetry.estimatedCostUsd = demoCost(telemetry);

  return { ...result, telemetry };
}

// Picks the canned result that matches the requested platform. Defaults to the
// .NET result. Matching is based on the language flag, then the file extension.
function pickDemoResult(ctx = {}) {
  const lang = String(ctx.language || "").toLowerCase();
  const name = String(ctx.fileName || "").toLowerCase();
  if (lang.includes("java") || name.endsWith(".java")) return JAVA_DEMO_RESULT;
  return DOTNET_DEMO_RESULT;
}

// Plausible per-agent token usage for the demo run, so the Run Stats panel
// shows realistic numbers without making any real API calls.
const DEMO_USAGE = {
  detect: { promptTokens: 1842, completionTokens: 731, totalTokens: 2573 },
  modernize: { promptTokens: 2156, completionTokens: 968, totalTokens: 3124 },
  score: { promptTokens: 1903, completionTokens: 402, totalTokens: 2305 },
};

// gpt-4o-mini estimated rates (per 1M tokens) for the demo cost figure.
function demoCost(telemetry) {
  return (telemetry.promptTokens / 1e6) * 0.15 + (telemetry.completionTokens / 1e6) * 0.6;
}

// Mirrors runPipeline(ctx, onEvent): emits the same stage events, with delays,
// then resolves with the canned result that matches the requested platform.
export async function runDemoPipeline(ctx = {}, onEvent = () => {}) {
  const result = pickDemoResult(ctx);
  const start = Date.now();
  const telemetry = { stages: [], promptTokens: 0, completionTokens: 0, totalTokens: 0, totalMs: 0 };
  const record = (stage, usage, ms) => {
    telemetry.stages.push({ stage, ...usage, ms });
    telemetry.promptTokens += usage.promptTokens;
    telemetry.completionTokens += usage.completionTokens;
    telemetry.totalTokens += usage.totalTokens;
  };

  onEvent({ type: "stage", stage: "detect", status: "start" });
  await sleep(1100);
  record("detect", DEMO_USAGE.detect, 1100);
  onEvent({
    type: "stage",
    stage: "detect",
    status: "done",
    count: result.findings.length,
    usage: DEMO_USAGE.detect,
    ms: 1100,
  });

  // The real graph fans out modernize + score in parallel after detect.
  onEvent({ type: "stage", stage: "modernize", status: "start" });
  onEvent({ type: "stage", stage: "score", status: "start" });

  await sleep(900);
  record("modernize", DEMO_USAGE.modernize, 900);
  onEvent({ type: "stage", stage: "modernize", status: "done", usage: DEMO_USAGE.modernize, ms: 900 });

  await sleep(600);
  record("score", DEMO_USAGE.score, 1500);
  onEvent({ type: "stage", stage: "score", status: "done", usage: DEMO_USAGE.score, ms: 1500 });

  await sleep(250);
  telemetry.totalMs = Date.now() - start;
  telemetry.provider = "demo";
  telemetry.model = "gpt-4o-mini (demo)";
  telemetry.estimatedCostUsd = demoCost(telemetry);

  return { ...result, telemetry };
}
