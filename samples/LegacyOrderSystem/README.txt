LegacyOrderSystem — sample legacy .NET Framework solution
=========================================================

This is a small, intentionally "legacy" Visual Studio solution you can use to
test the Cloud Readiness Analyzer's folder-upload feature.

It is a .NET Framework 4.6.1 console app with several deliberate
cloud-readiness problems spread across multiple .cs files:

  Program.cs                  - entry point; hardcoded environment flag
  AppSettings.cs              - hardcoded connection string, API key, SMTP creds,
                                C:\ log path, on-prem service URL
  Services/OrderService.cs    - writes logs to a hardcoded C:\ Windows path
  Services/PaymentGateway.cs  - obsolete WebClient, synchronous HTTP, global
                                ServicePointManager TLS pinning
  Services/EmailNotifier.cs   - obsolete SmtpClient, hardcoded SMTP credentials
  Data/CustomerRepository.cs  - hardcoded connection string, SQL built by string
                                concatenation (SQL-injection risk)
  App.config                  - connection string + secrets in plain config

How to test the analyzer:
  1. Start the Cloud Readiness Analyzer and open it in your browser.
  2. Click "+ select a folder".
  3. Choose this LegacyOrderSystem folder.
  4. It will combine all the .cs files and produce one cloud-readiness score.
  5. (Optional) Upload App.config in the "Config file" box for richer analysis.

Note: this project is for analysis/demo only. It is not meant to compile or run
as-is, and the credentials in it are fake placeholders.
