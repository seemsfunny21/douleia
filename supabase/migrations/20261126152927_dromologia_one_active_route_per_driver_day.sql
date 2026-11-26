-- Prevent assigning the same driver to two unfinished routes on the same service day.
-- Cancelling a departure removes the run, releasing both the route and driver.
CREATE UNIQUE INDEX IF NOT EXISTS dromologia_one_active_route_per_driver_day
ON public.dromologia_runs (service_date, driver_id)
WHERE arrival_at IS NULL;
