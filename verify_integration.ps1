# Transport Officer Integration Verification Script
# Run this to verify all files are in place

Write-Host "🔍 Verifying Transport Officer Portal Integration..." -ForegroundColor Cyan
Write-Host ""

$errors = 0
$warnings = 0

# Check Frontend HTML Files
Write-Host "📄 Checking HTML Files..." -ForegroundColor Yellow
$htmlFiles = @(
    "frontend/transport.html",
    "frontend/transport/dashboard.html",
    "frontend/transport/drivers.html",
    "frontend/transport/vehicles.html",
    "frontend/transport/duty.html",
    "frontend/transport/driver-analysis.html"
)

foreach ($file in $htmlFiles) {
    if (Test-Path $file) {
        Write-Host "  ✅ $file" -ForegroundColor Green
    } else {
        Write-Host "  ❌ Missing: $file" -ForegroundColor Red
        $errors++
    }
}

# Check JavaScript Files
Write-Host ""
Write-Host "📜 Checking JavaScript Files..." -ForegroundColor Yellow
$jsFiles = @(
    "frontend/js/transport-api.js",
    "frontend/js/transport-dashboard.js",
    "frontend/js/transport-drivers.js",
    "frontend/js/transport-vehicles.js",
    "frontend/js/transport-duty.js",
    "frontend/js/transport-driver-analysis.js"
)

foreach ($file in $jsFiles) {
    if (Test-Path $file) {
        # Check for syntax errors
        $check = node --check $file 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  ✅ $file (no syntax errors)" -ForegroundColor Green
        } else {
            Write-Host "  ⚠️  $file (syntax errors found)" -ForegroundColor Yellow
            $warnings++
        }
    } else {
        Write-Host "  ❌ Missing: $file" -ForegroundColor Red
        $errors++
    }
}

# Check Backend
Write-Host ""
Write-Host "🔧 Checking Backend..." -ForegroundColor Yellow
if (Test-Path "backend/server.js") {
    $serverContent = Get-Content "backend/server.js" -Raw
    if ($serverContent -match "requireTransportOfficer") {
        Write-Host "  ✅ Transport Officer middleware found" -ForegroundColor Green
    } else {
        Write-Host "  ❌ Transport Officer middleware not found" -ForegroundColor Red
        $errors++
    }
    
    if ($serverContent -match "/api/transport/dashboard") {
        Write-Host "  ✅ Transport API endpoints found" -ForegroundColor Green
    } else {
        Write-Host "  ❌ Transport API endpoints not found" -ForegroundColor Red
        $errors++
    }
} else {
    Write-Host "  ❌ backend/server.js not found" -ForegroundColor Red
    $errors++
}

# Check Auth Updates
Write-Host ""
Write-Host "🔐 Checking Authentication Updates..." -ForegroundColor Yellow
if (Test-Path "frontend/js/auth.js") {
    $authContent = Get-Content "frontend/js/auth.js" -Raw
    if ($authContent -match "transport_officer") {
        Write-Host "  ✅ auth.js supports transport_officer role" -ForegroundColor Green
    } else {
        Write-Host "  ❌ auth.js missing transport_officer support" -ForegroundColor Red
        $errors++
    }
}

if (Test-Path "frontend/js/login.js") {
    $loginContent = Get-Content "frontend/js/login.js" -Raw
    if ($loginContent -match "transport_officer") {
        Write-Host "  ✅ login.js has transport_officer redirect" -ForegroundColor Green
    } else {
        Write-Host "  ❌ login.js missing transport_officer redirect" -ForegroundColor Red
        $errors++
    }
}

# Check Schema Updates
Write-Host ""
Write-Host "📊 Checking Schema Files..." -ForegroundColor Yellow
if (Test-Path "schema.sql") {
    $schemaContent = Get-Content "schema.sql" -Raw
    if ($schemaContent -match "transport_officer") {
        Write-Host "  ✅ schema.sql includes transport_officer role" -ForegroundColor Green
    } else {
        Write-Host "  ❌ schema.sql missing transport_officer role" -ForegroundColor Red
        $errors++
    }
}

if (Test-Path "schema_update_roles.sql") {
    Write-Host "  ✅ schema_update_roles.sql exists (run in Supabase!)" -ForegroundColor Green
} else {
    Write-Host "  ⚠️  schema_update_roles.sql not found" -ForegroundColor Yellow
    $warnings++
}

# Check Admin Updates
Write-Host ""
Write-Host "👨‍💼 Checking Admin Portal Updates..." -ForegroundColor Yellow
$adminFiles = @(
    "frontend/admin/dashboard.html",
    "frontend/admin/verification.html",
    "frontend/admin/trips.html",
    "frontend/admin/bmc.html"
)

$fleetRemoved = $true
foreach ($file in $adminFiles) {
    if (Test-Path $file) {
        $content = Get-Content $file -Raw
        if ($content -match "fleet\.html") {
            Write-Host "  ⚠️  $file still has fleet.html link" -ForegroundColor Yellow
            $fleetRemoved = $false
            $warnings++
        }
    }
}

if ($fleetRemoved) {
    Write-Host "  ✅ Fleet navigation removed from all admin pages" -ForegroundColor Green
}

# Check Registration
Write-Host ""
Write-Host "📝 Checking Registration Updates..." -ForegroundColor Yellow
if (Test-Path "frontend/register.html") {
    $regContent = Get-Content "frontend/register.html" -Raw
    if ($regContent -match "driver") {
        Write-Host "  ✅ Registration includes driver role option" -ForegroundColor Green
    } else {
        Write-Host "  ⚠️  Registration missing driver role option" -ForegroundColor Yellow
        $warnings++
    }
}

# Summary
Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host "Verification Complete!" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Errors: $errors" -ForegroundColor $(if ($errors -eq 0) { "Green" } else { "Red" })
Write-Host "Warnings: $warnings" -ForegroundColor $(if ($warnings -eq 0) { "Green" } else { "Yellow" })
Write-Host ""

if ($errors -eq 0 -and $warnings -eq 0) {
    Write-Host "✅ All checks passed! Integration is complete." -ForegroundColor Green
    Write-Host ""
    Write-Host "Next Steps:" -ForegroundColor Cyan
    Write-Host "1. Run SQL in schema_update_roles.sql in Supabase" -ForegroundColor White
    Write-Host "2. Start backend: cd backend && npm start" -ForegroundColor White
    Write-Host "3. Login at: http://localhost:5000/login.html" -ForegroundColor White
} elseif ($errors -eq 0) {
    Write-Host "⚠️  Integration complete with minor warnings." -ForegroundColor Yellow
    Write-Host "Review warnings above and proceed with testing." -ForegroundColor White
} else {
    Write-Host "❌ Integration has errors. Please fix the issues above." -ForegroundColor Red
}

Write-Host ""
