using System;
using System.IO;
using LegacyOrderSystem.Data;

namespace LegacyOrderSystem.Services
{
    // Orchestrates placing an order: looks up the customer, charges payment,
    // sends a confirmation email, and writes a log line to a local file.
    public class OrderService
    {
        private readonly CustomerRepository _customers;
        private readonly PaymentGateway _payment;
        private readonly EmailNotifier _email;

        public OrderService(CustomerRepository customers, PaymentGateway payment, EmailNotifier email)
        {
            _customers = customers;
            _payment = payment;
            _email = email;
        }

        public void PlaceOrder(string customerId, string sku, int quantity)
        {
            var customer = _customers.GetCustomer(customerId);
            if (customer == null)
            {
                throw new Exception("Customer not found: " + customerId);
            }

            decimal unitPrice = 19.99m;
            decimal total = unitPrice * quantity;

            bool charged = _payment.Charge(customer.Email, total);
            if (!charged)
            {
                throw new Exception("Payment failed for " + customer.Email);
            }

            _email.SendConfirmation(customer.Email, sku, quantity, total);

            // Writes to a hardcoded local Windows path; fails on a cloud host
            // where the filesystem is ephemeral and the C:\ drive does not exist.
            string logLine = string.Format("{0} | {1} ordered {2} x {3} = {4:C}{5}",
                DateTime.Now, customer.Email, quantity, sku, total, Environment.NewLine);
            File.AppendAllText(AppSettings.LogFolder + "orders.log", logLine);

            Console.WriteLine("Order placed for " + customer.Email);
        }
    }
}
