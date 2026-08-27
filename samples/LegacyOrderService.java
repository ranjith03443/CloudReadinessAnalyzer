package com.contoso.orders;

import java.io.FileWriter;
import java.io.IOException;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.Date;
import java.util.Hashtable;
import java.util.Vector;

// Legacy Java service (pre-cloud, Java 8 style).
public class LegacyOrderService {

    // Hardcoded connection string with embedded credentials.
    private static final String JDBC_URL =
            "jdbc:mysql://PROD-DB01:3306/orders?user=root&password=P@ssw0rd123";

    // Hardcoded local file path for logging.
    private static final String LOG_PATH = "/var/app/logs/order-service.log";

    public Hashtable<String, Object> getOrder(int orderId) throws Exception {
        Hashtable<String, Object> result = new Hashtable<String, Object>();

        // Deprecated: explicit driver class loading.
        Class.forName("com.mysql.jdbc.Driver");

        Connection conn = DriverManager.getConnection(JDBC_URL);
        Statement stmt = conn.createStatement();
        // String concatenation -> SQL injection.
        ResultSet rs = stmt.executeQuery("SELECT * FROM orders WHERE id = " + orderId);
        while (rs.next()) {
            result.put("id", rs.getInt("id"));
            result.put("customer", rs.getString("customer"));
            result.put("total", rs.getDouble("total"));
        }
        conn.close();

        log("Fetched order " + orderId);
        return result;
    }

    public Vector<String> getRecent() {
        // Vector is a legacy synchronized collection.
        Vector<String> items = new Vector<String>();
        items.add("order-1");
        return items;
    }

    private void log(String message) {
        // Writes to a fixed local path that won't exist on a cloud host / container.
        try (FileWriter fw = new FileWriter(LOG_PATH, true)) {
            fw.write(new Date() + " " + message + "\n");
        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}
