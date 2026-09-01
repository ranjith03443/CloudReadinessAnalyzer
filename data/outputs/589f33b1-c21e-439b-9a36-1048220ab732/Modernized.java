// LegacyOrderService.java â€” modernized for Spring Boot / cloud
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
        // Parameterized query â€” no string concatenation, no SQL injection.
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
}
