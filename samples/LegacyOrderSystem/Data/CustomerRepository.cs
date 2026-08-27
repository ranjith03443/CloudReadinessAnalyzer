using System;
using System.Data;
using System.Data.SqlClient;

namespace LegacyOrderSystem.Data
{
    public class Customer
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string Email { get; set; }
    }

    // Reads customers from SQL Server using ADO.NET with a hardcoded connection
    // string and a SQL query built by string concatenation (SQL-injection risk).
    public class CustomerRepository
    {
        public Customer GetCustomer(string customerId)
        {
            // Hardcoded connection string from AppSettings instead of config.
            using (var conn = new SqlConnection(AppSettings.ConnectionString))
            {
                conn.Open();

                // String concatenation in SQL — vulnerable to SQL injection.
                string sql = "SELECT Id, Name, Email FROM Customers WHERE Id = '"
                             + customerId + "'";

                using (var cmd = new SqlCommand(sql, conn))
                using (SqlDataReader reader = cmd.ExecuteReader())
                {
                    if (reader.Read())
                    {
                        return new Customer
                        {
                            Id = reader["Id"].ToString(),
                            Name = reader["Name"].ToString(),
                            Email = reader["Email"].ToString()
                        };
                    }
                }
            }

            return null;
        }
    }
}
