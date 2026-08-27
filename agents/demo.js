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
